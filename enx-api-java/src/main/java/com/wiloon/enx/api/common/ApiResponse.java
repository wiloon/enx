package com.wiloon.enx.api.common;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse(
        @JsonProperty("success") boolean success, @JsonProperty("message") String message) {

    public static ApiResponse ok() {
        return new ApiResponse(true, null);
    }

    public static ApiResponse error(String message) {
        return new ApiResponse(false, message);
    }
}
