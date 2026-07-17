package com.wiloon.enx.application.log;

import com.wiloon.enx.domain.log.FrontendLog;
import com.wiloon.enx.domain.log.FrontendLogWriter;
import org.springframework.stereotype.Service;

@Service
public class FrontendLogService {

    private final FrontendLogWriter frontendLogWriter;

    public FrontendLogService(FrontendLogWriter frontendLogWriter) {
        this.frontendLogWriter = frontendLogWriter;
    }

    public void record(FrontendLog log) {
        frontendLogWriter.write(log);
    }
}
