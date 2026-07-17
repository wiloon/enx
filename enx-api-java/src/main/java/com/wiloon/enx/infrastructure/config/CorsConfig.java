package com.wiloon.enx.infrastructure.config;

import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
public class CorsConfig {

    @Bean
    CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOriginPatterns(List.of(
                "http://localhost:3000",
                "https://enx-ui.wiloon.com",
                "https://enx-ui-lab.wiloon.com",
                "https://enx-dev.wiloon.com",
                "chrome-extension://*",
                "moz-extension://*"));
        configuration.setAllowedMethods(List.of("GET", "POST", "OPTIONS", "PUT", "DELETE"));
        configuration.setAllowedHeaders(List.of(
                "Origin",
                "Authorization",
                "X-Session-ID",
                "X-User-ID",
                "Content-Type",
                "Cookie"));
        configuration.setExposedHeaders(List.of("Content-Length"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(43200L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
