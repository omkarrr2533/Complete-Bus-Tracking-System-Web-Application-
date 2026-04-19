package com.citybus.websocket;

import com.citybus.model.BusLocation;
import com.citybus.service.AuthService;
import com.citybus.service.BusTrackingService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class BusTrackingWebSocketHandler implements WebSocketHandler {

    private final BusTrackingService busTrackingService;
    private final AuthService authService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // Store active sessions
    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Object>> sessionData = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Object>> activeDrivers = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Object>> activeUsers = new ConcurrentHashMap<>();

    public BusTrackingWebSocketHandler(BusTrackingService busTrackingService, AuthService authService) {
        this.busTrackingService = busTrackingService;
        this.authService = authService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        sessions.put(session.getId(), session);
        System.out.println("WebSocket connection established: " + session.getId());

         sendMessage(session, "connection-established", Map.of(
                "sessionId", session.getId(),
                "timestamp", System.currentTimeMillis()
        ));
    }

    @Override
    public void handleMessage(WebSocketSession session, WebSocketMessage<?> message) throws Exception {
        try {
            String payload = message.getPayload().toString();
            JsonNode jsonNode = objectMapper.readTree(payload);
            String messageType = jsonNode.has("type") ? jsonNode.get("type").asText() : "unknown";

            System.out.println("Received message type: " + messageType + " from session: " + session.getId());

            switch (messageType) {
                case "driver-register":
                    handleDriverRegister(session, jsonNode);
                    break;
                case "driver-location":
                    handleDriverLocation(session, jsonNode);
                    break;
                case "user-register":
                    handleUserRegister(session, jsonNode);
                    break;
                case "user-location":
                    handleUserLocation(session, jsonNode);
                    break;
                case "get-active-buses":
                    handleGetActiveBuses(session);
                    break;
                case "get-other-drivers":
                    handleGetOtherDrivers(session, jsonNode);
                    break;
                case "driver-visibility":
                    handleDriverVisibility(session, jsonNode);
                    break;
                case "track-bus":
                    handleTrackBus(session, jsonNode);
                    break;
                case "ping":
                    handlePing(session);
                    break;
                default:
                    sendErrorMessage(session, "Unknown message type: " + messageType);
            }
        } catch (Exception e) {
            System.err.println("Error handling WebSocket message: " + e.getMessage());
            sendErrorMessage(session, "Error processing message: " + e.getMessage());
        }
    }

    private void handleDriverRegister(WebSocketSession session, JsonNode jsonNode) throws IOException {
        JsonNode data = jsonNode.get("data");
        if (data != null && data.has("driverId") && data.has("busId")) {
            String driverId = data.get("driverId").asText();
            String busId = data.get("busId").asText();

            Map<String, Object> driverInfo = new HashMap<>();
            driverInfo.put("sessionId", session.getId());
            driverInfo.put("driverId", driverId);
            driverInfo.put("busId", busId);
            driverInfo.put("coords", null);
            driverInfo.put("visible", true);
            driverInfo.put("lastSeen", System.currentTimeMillis());
            driverInfo.put("status", "active");

            activeDrivers.put(driverId, driverInfo);
            sessionData.put(session.getId(), driverInfo);

            System.out.println("Driver registered: " + driverId + " with bus: " + busId);

            sendMessage(session, "driver-registered", Map.of(
                    "driverId", driverId,
                    "busId", busId,
                    "status", "success"
            ));

             broadcastToUsers("new-driver-available", Map.of(
                    "driverId", driverId,
                    "busId", busId,
                    "timestamp", System.currentTimeMillis()
            ));
        }
    }

    private void handleDriverLocation(WebSocketSession session, JsonNode jsonNode) throws IOException {
        JsonNode data = jsonNode.get("data");
        if (data != null && data.has("driverId") && data.has("coords")) {
            String driverId = data.get("driverId").asText();
            String busId = data.has("busId") ? data.get("busId").asText() : null;
            JsonNode coordsNode = data.get("coords");

            if (coordsNode.isArray() && coordsNode.size() >= 2) {
                double[] coords = new double[]{
                        coordsNode.get(0).asDouble(),
                        coordsNode.get(1).asDouble()
                };

                Map<String, Object> driverInfo = activeDrivers.get(driverId);
                if (driverInfo != null) {
                    driverInfo.put("coords", coords);
                    driverInfo.put("lastSeen", System.currentTimeMillis());
                    driverInfo.put("accuracy", data.has("accuracy") ? data.get("accuracy").asDouble() : 0);
                    driverInfo.put("visible", data.has("visible") ? data.get("visible").asBoolean() : true);

                    // Update bus tracking service
                    if (busId != null) {
                        BusLocation busLocation = new BusLocation();
                        busLocation.setRouteId(busId.contains("bus-1") ? "1" : "2");
                        busLocation.setCoords(coords);
                        busLocation.setSource("driver");
                        busTrackingService.updateBusLocation(busId, busLocation);
                    }

                    System.out.println("Updated location for driver: " + driverId + " at " + Arrays.toString(coords));

                    sendMessage(session, "location-acknowledged", Map.of(
                            "driverId", driverId,
                            "timestamp", System.currentTimeMillis()
                    ));

                     broadcastLocationUpdate(driverInfo);
                }
            }
        }
    }

    private void handleUserRegister(WebSocketSession session, JsonNode jsonNode) throws IOException {
        JsonNode data = jsonNode.get("data");
        String userId = data != null && data.has("userId") ? data.get("userId").asText() : "user_" + session.getId().substring(0, 8);

        Map<String, Object> userInfo = new HashMap<>();
        userInfo.put("sessionId", session.getId());
        userInfo.put("userId", userId);
        userInfo.put("coords", null);
        userInfo.put("trackingBusId", null);
        userInfo.put("lastSeen", System.currentTimeMillis());

        activeUsers.put(userId, userInfo);
        sessionData.put(session.getId(), userInfo);

        System.out.println("User registered: " + userId);

        sendMessage(session, "user-registered", Map.of(
                "userId", userId,
                "status", "success"
        ));

        // Send current active buses to the new user
        sendActiveBusesToUser(session);
    }

    private void handleUserLocation(WebSocketSession session, JsonNode jsonNode) throws IOException {
        JsonNode data = jsonNode.get("data");
        if (data != null && data.has("coords")) {
            JsonNode coordsNode = data.get("coords");
            if (coordsNode.isArray() && coordsNode.size() >= 2) {
                double[] coords = new double[]{
                        coordsNode.get(0).asDouble(),
                        coordsNode.get(1).asDouble()
                };

                Map<String, Object> sessionInfo = sessionData.get(session.getId());
                if (sessionInfo != null) {
                    sessionInfo.put("coords", coords);
                    sessionInfo.put("lastSeen", System.currentTimeMillis());

                    String userId = (String) sessionInfo.get("userId");
                    if (userId != null && activeUsers.containsKey(userId)) {
                        activeUsers.get(userId).put("coords", coords);
                    }
                }
            }
        }
    }

    private void handleGetActiveBuses(WebSocketSession session) throws IOException {
        sendActiveBusesToUser(session);
    }

    private void handleGetOtherDrivers(WebSocketSession session, JsonNode jsonNode) throws IOException {
        JsonNode data = jsonNode.get("data");
        String requestingDriverId = data != null && data.has("driverId") ? data.get("driverId").asText() : null;

        List<Map<String, Object>> otherDrivers = new ArrayList<>();
        for (Map.Entry<String, Map<String, Object>> entry : activeDrivers.entrySet()) {
            String driverId = entry.getKey();
            Map<String, Object> driverInfo = entry.getValue();

            if (!driverId.equals(requestingDriverId) && Boolean.TRUE.equals(driverInfo.get("visible"))) {
                Map<String, Object> driverData = new HashMap<>();
                driverData.put("driverId", driverId);
                driverData.put("busId", driverInfo.get("busId"));
                driverData.put("coords", driverInfo.get("coords"));
                driverData.put("lastSeen", driverInfo.get("lastSeen"));
                driverData.put("status", driverInfo.get("status"));
                otherDrivers.add(driverData);
            }
        }

        sendMessage(session, "other-drivers", otherDrivers);
    }

    private void handleDriverVisibility(WebSocketSession session, JsonNode jsonNode) throws IOException {
        JsonNode data = jsonNode.get("data");
        if (data != null && data.has("driverId")) {
            String driverId = data.get("driverId").asText();
            boolean visible = data.has("visible") ? data.get("visible").asBoolean() : true;

            Map<String, Object> driverInfo = activeDrivers.get(driverId);
            if (driverInfo != null) {
                driverInfo.put("visible", visible);
                System.out.println("Driver " + driverId + " visibility set to: " + visible);
            }
        }
    }

    private void handleTrackBus(WebSocketSession session, JsonNode jsonNode) throws IOException {
        JsonNode data = jsonNode.get("data");
        if (data != null && data.has("busId")) {
            String busId = data.get("busId").asText();

            Map<String, Object> sessionInfo = sessionData.get(session.getId());
            if (sessionInfo != null) {
                sessionInfo.put("trackingBusId", busId);

                String userId = (String) sessionInfo.get("userId");
                if (userId != null && activeUsers.containsKey(userId)) {
                    activeUsers.get(userId).put("trackingBusId", busId);
                }

                sendMessage(session, "tracking-started", Map.of(
                        "busId", busId,
                        "status", "success"
                ));
            }
        }
    }

    private void handlePing(WebSocketSession session) throws IOException {
        sendMessage(session, "pong", Map.of("timestamp", System.currentTimeMillis()));
    }

    private void sendActiveBusesToUser(WebSocketSession session) throws IOException {
        List<Map<String, Object>> activeBuses = new ArrayList<>();

        for (Map.Entry<String, Map<String, Object>> entry : activeDrivers.entrySet()) {
            Map<String, Object> driverInfo = entry.getValue();
            if (Boolean.TRUE.equals(driverInfo.get("visible")) && driverInfo.get("coords") != null) {
                Map<String, Object> busData = new HashMap<>();
                busData.put("busId", driverInfo.get("busId"));
                busData.put("driverId", entry.getKey());
                busData.put("coords", driverInfo.get("coords"));
                busData.put("lastSeen", driverInfo.get("lastSeen"));
                busData.put("status", driverInfo.get("status"));
                activeBuses.add(busData);
            }
        }

        sendMessage(session, "active-buses", activeBuses);
    }

    private void broadcastLocationUpdate(Map<String, Object> driverInfo) {
        if (!Boolean.TRUE.equals(driverInfo.get("visible"))) return;

        Map<String, Object> locationData = new HashMap<>();
        locationData.put("driverId", driverInfo.get("driverId"));
        locationData.put("busId", driverInfo.get("busId"));
        locationData.put("coords", driverInfo.get("coords"));
        locationData.put("timestamp", System.currentTimeMillis());

        // Broadcast to all users
        broadcastToUsers("bus-location-update", locationData);

        // Broadcast to other drivers
        broadcastToOtherDrivers("driver-location-update", locationData, (String) driverInfo.get("driverId"));
    }

    private void broadcastToUsers(String messageType, Object data) {
        for (Map.Entry<String, Map<String, Object>> entry : activeUsers.entrySet()) {
            Map<String, Object> userInfo = entry.getValue();
            String sessionId = (String) userInfo.get("sessionId");
            WebSocketSession session = sessions.get(sessionId);

            if (session != null && session.isOpen()) {
                try {
                    sendMessage(session, messageType, data);
                } catch (IOException e) {
                    System.err.println("Failed to send message to user: " + e.getMessage());
                }
            }
        }
    }

    private void broadcastToOtherDrivers(String messageType, Object data, String excludeDriverId) {
        for (Map.Entry<String, Map<String, Object>> entry : activeDrivers.entrySet()) {
            String driverId = entry.getKey();
            if (!driverId.equals(excludeDriverId)) {
                Map<String, Object> driverInfo = entry.getValue();
                String sessionId = (String) driverInfo.get("sessionId");
                WebSocketSession session = sessions.get(sessionId);

                if (session != null && session.isOpen()) {
                    try {
                        sendMessage(session, messageType, data);
                    } catch (IOException e) {
                        System.err.println("Failed to send message to driver " + driverId + ": " + e.getMessage());
                    }
                }
            }
        }
    }

    private void sendMessage(WebSocketSession session, String type, Object data) throws IOException {
        if (session.isOpen()) {
            Map<String, Object> message = new HashMap<>();
            message.put("type", type);
            message.put("data", data);
            String jsonMessage = objectMapper.writeValueAsString(message);
            session.sendMessage(new TextMessage(jsonMessage));
        }
    }

    private void sendErrorMessage(WebSocketSession session, String errorMessage) {
        try {
            sendMessage(session, "error", Map.of("message", errorMessage));
        } catch (IOException e) {
            System.err.println("Failed to send error message: " + e.getMessage());
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        System.err.println("WebSocket transport error for session " + session.getId() + ": " + exception.getMessage());
        cleanupSession(session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus closeStatus) throws Exception {
        System.out.println("WebSocket connection closed: " + session.getId() + " - " + closeStatus);
        cleanupSession(session);
    }

    private void cleanupSession(WebSocketSession session) {
        sessions.remove(session.getId());
        Map<String, Object> sessionInfo = sessionData.remove(session.getId());

        if (sessionInfo != null) {
            String driverId = (String) sessionInfo.get("driverId");
            String userId = (String) sessionInfo.get("userId");

            if (driverId != null) {
                activeDrivers.remove(driverId);
                // Notify users that driver left
                broadcastToUsers("driver-left", Map.of("driverId", driverId));
                System.out.println("Driver disconnected: " + driverId);
            }

            if (userId != null) {
                activeUsers.remove(userId);
                System.out.println("User disconnected: " + userId);
            }
        }
    }

    @Override
    public boolean supportsPartialMessages() {
        return false;
    }

    // Scheduled task to send active buses to users every 10 seconds
    @Scheduled(fixedRate = 10000)
    public void broadcastActiveBuses() {
        if (activeUsers.isEmpty()) return;

        List<Map<String, Object>> activeBuses = new ArrayList<>();

        for (Map.Entry<String, Map<String, Object>> entry : activeDrivers.entrySet()) {
            Map<String, Object> driverInfo = entry.getValue();
            if (Boolean.TRUE.equals(driverInfo.get("visible")) && driverInfo.get("coords") != null) {
                Map<String, Object> busData = new HashMap<>();
                busData.put("busId", driverInfo.get("busId"));
                busData.put("driverId", entry.getKey());
                busData.put("coords", driverInfo.get("coords"));
                busData.put("lastSeen", driverInfo.get("lastSeen"));
                activeBuses.add(busData);
            }
        }

        if (!activeBuses.isEmpty()) {
            broadcastToUsers("active-buses", activeBuses);
        }
    }

    // Cleanup inactive sessions every 30 seconds
    @Scheduled(fixedRate = 30000)
    public void cleanupInactiveSessions() {
        long now = System.currentTimeMillis();
        long timeout = 2 * 60 * 1000; // 2 minutes

        // Clean up inactive drivers
        activeDrivers.entrySet().removeIf(entry -> {
            Map<String, Object> driverInfo = entry.getValue();
            Long lastSeen = (Long) driverInfo.get("lastSeen");
            if (lastSeen != null && (now - lastSeen) > timeout) {
                String sessionId = (String) driverInfo.get("sessionId");
                sessions.remove(sessionId);
                sessionData.remove(sessionId);
                System.out.println("Removed inactive driver: " + entry.getKey());
                return true;
            }
            return false;
        });

        // Clean up inactive users
        activeUsers.entrySet().removeIf(entry -> {
            Map<String, Object> userInfo = entry.getValue();
            Long lastSeen = (Long) userInfo.get("lastSeen");
            if (lastSeen != null && (now - lastSeen) > timeout) {
                String sessionId = (String) userInfo.get("sessionId");
                sessions.remove(sessionId);
                sessionData.remove(sessionId);
                System.out.println("Removed inactive user: " + entry.getKey());
                return true;
            }
            return false;
        });
    }
}
