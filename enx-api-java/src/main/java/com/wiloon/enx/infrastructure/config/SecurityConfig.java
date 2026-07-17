package com.wiloon.enx.infrastructure.config;

import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoders;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http.csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth.requestMatchers("/actuator/health", "/actuator/health/**")
                        .permitAll()
                        .requestMatchers(HttpMethod.OPTIONS, "/**")
                        .permitAll()
                        .anyRequest()
                        .authenticated())
                .exceptionHandling(ex -> ex.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
                .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()));
        return http.build();
    }

    @Bean
    @Profile("!test")
    JwtDecoder jwtDecoder(CognitoProperties cognitoProperties) {
        if (!cognitoProperties.isValid()) {
            throw new IllegalStateException(
                    "Incomplete Cognito configuration: region, userPoolId, and at least one client ID are required");
        }

        NimbusJwtDecoder decoder =
                JwtDecoders.fromIssuerLocation(cognitoProperties.issuerUri());

        OAuth2TokenValidator<Jwt> issuerValidator =
                JwtValidators.createDefaultWithIssuer(cognitoProperties.issuerUri());
        OAuth2TokenValidator<Jwt> audienceValidator = jwt -> {
            if (isAudienceAllowed(jwt, cognitoProperties.clientIds())) {
                return OAuth2TokenValidatorResult.success();
            }
            return OAuth2TokenValidatorResult.failure(
                    new OAuth2Error("invalid_token", "Invalid token audience/client_id", null));
        };

        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(issuerValidator, audienceValidator));
        return decoder;
    }

    static boolean isAudienceAllowed(Jwt jwt, List<String> allowedClientIds) {
        String tokenUse = jwt.getClaimAsString("token_use");
        if ("access".equals(tokenUse)) {
            String clientId = jwt.getClaimAsString("client_id");
            return clientId != null && allowedClientIds.contains(clientId);
        }
        if ("id".equals(tokenUse)) {
            return jwt.getAudience().stream().anyMatch(allowedClientIds::contains);
        }

        String clientId = jwt.getClaimAsString("client_id");
        if (clientId != null && allowedClientIds.contains(clientId)) {
            return true;
        }
        return jwt.getAudience().stream().anyMatch(allowedClientIds::contains);
    }
}
