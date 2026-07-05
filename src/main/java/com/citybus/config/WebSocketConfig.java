package com.citybus.config;

import com.citybus.websocket.BusTrackingWebSocketHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final BusTrackingWebSocketHandler webSocketHandler;
    private final String[] allowedOriginPatterns;

    public WebSocketConfig(BusTrackingWebSocketHandler webSocketHandler,
                           @Value("${app.cors.allowed-origins:*}") String[] allowedOriginPatterns) {
        this.webSocketHandler = webSocketHandler;
        this.allowedOriginPatterns = allowedOriginPatterns;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(webSocketHandler, "/websocket")
                .setAllowedOriginPatterns(allowedOriginPatterns);
    }
}
