package com.wiloon.enx.api.log;

import com.wiloon.enx.api.common.ApiResponse;
import com.wiloon.enx.application.log.FrontendLogService;
import com.wiloon.enx.domain.log.FrontendLog;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class LogController {

    private final FrontendLogService frontendLogService;

    public LogController(FrontendLogService frontendLogService) {
        this.frontendLogService = frontendLogService;
    }

    @PostMapping(value = "/log", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ApiResponse> createLog(@RequestBody LogRequest request) {
        frontendLogService.record(new FrontendLog(request.event(), request.message(), request.timestamp()));
        return ResponseEntity.ok(ApiResponse.ok());
    }
}
