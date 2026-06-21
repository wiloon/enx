package com.wiloon.enx.infrastructure.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;

@Configuration
@Profile("test")
public class TestJwtDecoderConfig {

    @Bean
    JwtDecoder jwtDecoder() {
        return token -> Jwt.withTokenValue(token)
                .header("alg", "none")
                .subject("test-sub")
                .claim("client_id", "test-ui-client")
                .claim("token_use", "access")
                .issuer("https://cognito-idp.us-east-1.amazonaws.com/test-pool")
                .build();
    }
}
