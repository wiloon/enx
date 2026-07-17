package com.wiloon.enx.api.log;

import com.fasterxml.jackson.annotation.JsonProperty;

public record LogRequest(
        @JsonProperty("event") String event,
        @JsonProperty("message") String message,
        @JsonProperty("timestamp") String timestamp) {}
