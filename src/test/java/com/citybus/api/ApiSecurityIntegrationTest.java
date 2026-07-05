package com.citybus.api;

import com.citybus.domain.Bus;
import com.citybus.domain.GeoPoint;
import com.citybus.domain.Route;
import com.citybus.domain.Stop;
import com.citybus.domain.UserAccount;
import com.citybus.domain.UserRole;
import com.citybus.repository.BusRepository;
import com.citybus.repository.RouteRepository;
import com.citybus.repository.UserRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalTime;
import java.util.List;

import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * End-to-end contract tests through the real filter chain: login issues a
 * token, reads are public, writes require the ADMIN role, and errors follow
 * the ApiError shape.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ApiSecurityIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private UserRepository userRepository;
    @Autowired private RouteRepository routeRepository;
    @Autowired private BusRepository busRepository;
    @Autowired private PasswordEncoder passwordEncoder;

    private Long seededRouteId;

    @BeforeEach
    void seed() {
        busRepository.deleteAll();
        userRepository.deleteAll();
        routeRepository.deleteAll();

        Route route = new Route();
        route.setRouteNumber(1);
        route.setName("Seed Route");
        route.setColor("#1d4ed8");
        route.setFirstBus(LocalTime.of(6, 0));
        route.setLastBus(LocalTime.of(22, 0));
        route.setFrequencyMinutes(15);
        route.setPath(List.of(new GeoPoint(19.85, 75.30), new GeoPoint(19.86, 75.31)));
        route.setStops(List.of(new Stop("A", 19.85, 75.30), new Stop("B", 19.86, 75.31)));
        seededRouteId = routeRepository.save(route).getId();

        Bus bus = busRepository.save(new Bus("bus-1", route));
        userRepository.save(new UserAccount("admin", passwordEncoder.encode("admin123"),
                "Admin", UserRole.ADMIN, null));
        userRepository.save(new UserAccount("driver1", passwordEncoder.encode("password123"),
                "Driver One", UserRole.DRIVER, bus));
    }

    private String login(String username, String password) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + username + "\",\"password\":\"" + password + "\"}"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        return body.get("accessToken").asText();
    }

    private String newRouteJson(int number) {
        return """
                {
                  "routeNumber": %d,
                  "name": "Integration Route",
                  "color": "#0f766e",
                  "firstBus": "06:00",
                  "lastBus": "22:00",
                  "frequencyMinutes": 12,
                  "active": true,
                  "path": [[19.85, 75.30], [19.86, 75.31]],
                  "stops": [
                    {"name": "One", "lat": 19.85, "lng": 75.30},
                    {"name": "Two", "lat": 19.86, "lng": 75.31}
                  ]
                }
                """.formatted(number);
    }

    @Test
    void loginRejectsBadCredentialsWithApiErrorShape() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"admin\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.message").value("Invalid username or password"));
    }

    @Test
    void routesAreReadableWithoutAuthentication() throws Exception {
        mockMvc.perform(get("/api/v1/routes"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].name").value("Seed Route"))
                .andExpect(jsonPath("$[0].stops", hasSize(2)));
    }

    @Test
    void anonymousWriteIsRejected() throws Exception {
        mockMvc.perform(post("/api/v1/routes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(newRouteJson(9)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void driverTokenCannotWrite() throws Exception {
        String driverToken = login("driver1", "password123");

        mockMvc.perform(post("/api/v1/routes")
                        .header("Authorization", "Bearer " + driverToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(newRouteJson(9)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.status").value(403));
    }

    @Test
    void adminCanCreateRoute() throws Exception {
        String adminToken = login("admin", "admin123");

        mockMvc.perform(post("/api/v1/routes")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(newRouteJson(9)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.routeNumber").value(9))
                .andExpect(jsonPath("$.id").isNumber());
    }

    @Test
    void validationFailureListsFieldErrors() throws Exception {
        String adminToken = login("admin", "admin123");
        String invalid = """
                {
                  "routeNumber": 0,
                  "name": "",
                  "color": "blue",
                  "firstBus": "6am",
                  "lastBus": "22:00",
                  "frequencyMinutes": 0,
                  "path": [[19.85, 75.30], [19.86, 75.31]],
                  "stops": [
                    {"name": "One", "lat": 19.85, "lng": 75.30},
                    {"name": "Two", "lat": 19.86, "lng": 75.31}
                  ]
                }
                """;

        mockMvc.perform(post("/api/v1/routes")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(invalid))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Validation Failed"))
                .andExpect(jsonPath("$.fieldErrors", hasSize(greaterThanOrEqualTo(4))));
    }

    @Test
    void deletingRouteWithAssignedBusesConflicts() throws Exception {
        String adminToken = login("admin", "admin123");

        mockMvc.perform(delete("/api/v1/routes/" + seededRouteId)
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409));
    }

    @Test
    void busesEndpointIsPaginated() throws Exception {
        mockMvc.perform(get("/api/v1/buses?page=0&size=10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", hasSize(1)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].code").value("bus-1"))
                .andExpect(jsonPath("$.content[0].routeName").value("Seed Route"));
    }

    @Test
    void meEndpointRequiresToken() throws Exception {
        mockMvc.perform(get("/api/v1/auth/me"))
                .andExpect(status().isUnauthorized());

        String adminToken = login("admin", "admin123");
        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", "Bearer " + adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("admin"))
                .andExpect(jsonPath("$.role").value("ADMIN"));
    }

    @Test
    void unknownRouteReturnsApiError404() throws Exception {
        mockMvc.perform(get("/api/v1/routes/424242"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.path").value("/api/v1/routes/424242"));
    }
}
