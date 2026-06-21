package com.wiloon.enx.infrastructure.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class SecurityConfigAudienceTest {

    @Test
    void acceptsAccessTokenWithMatchingClientId() {
        Jwt jwt = Jwt.withTokenValue("token")
                .header("alg", "RS256")
                .claim("token_use", "access")
                .claim("client_id", "ui-client")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(3600))
                .build();

        assertThat(SecurityConfig.isAudienceAllowed(jwt, List.of("ui-client", "chrome-client")))
                .isTrue();
    }

    @Test
    void rejectsAccessTokenWithUnknownClientId() {
        Jwt jwt = Jwt.withTokenValue("token")
                .header("alg", "RS256")
                .claim("token_use", "access")
                .claim("client_id", "other-client")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(3600))
                .build();

        assertThat(SecurityConfig.isAudienceAllowed(jwt, List.of("ui-client")))
                .isFalse();
    }

    @Test
    void acceptsIdTokenAudience() {
        Jwt jwt = Jwt.withTokenValue("token")
                .header("alg", "RS256")
                .claim("token_use", "id")
                .audience(List.of("ui-client"))
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(3600))
                .build();

        assertThat(SecurityConfig.isAudienceAllowed(jwt, List.of("ui-client")))
                .isTrue();
    }
}
