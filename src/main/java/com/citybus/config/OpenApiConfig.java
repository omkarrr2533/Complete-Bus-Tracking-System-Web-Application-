package com.citybus.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI cityBusOpenApi() {
        String scheme = "bearerAuth";
        return new OpenAPI()
                .info(new Info()
                        .title("CityBus Tracker API")
                        .version("v1")
                        .description("Real-time city bus tracking platform: fleet CRUD, "
                                + "JWT authentication, and live telemetry endpoints. "
                                + "Log in via /api/v1/auth/login and click Authorize to use admin endpoints."))
                .components(new Components().addSecuritySchemes(scheme,
                        new SecurityScheme()
                                .name(scheme)
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")))
                .addSecurityItem(new SecurityRequirement().addList(scheme));
    }
}
