package com.wiloon.enx.infrastructure.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "enx.cognito")
public record CognitoProperties(
        String region,
        String userPoolId,
        String clientId,
        String chromeClientId) {

    public String issuerUri() {
        return "https://cognito-idp.%s.amazonaws.com/%s".formatted(region, userPoolId);
    }

    public List<String> clientIds() {
        return List.of(clientId, chromeClientId).stream()
                .filter(id -> id != null && !id.isBlank())
                .distinct()
                .toList();
    }

    public boolean isValid() {
        return region != null
                && !region.isBlank()
                && userPoolId != null
                && !userPoolId.isBlank()
                && !clientIds().isEmpty();
    }
}
