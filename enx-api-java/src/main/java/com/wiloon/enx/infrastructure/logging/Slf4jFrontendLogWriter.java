package com.wiloon.enx.infrastructure.logging;

import com.wiloon.enx.domain.log.FrontendLog;
import com.wiloon.enx.domain.log.FrontendLogWriter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class Slf4jFrontendLogWriter implements FrontendLogWriter {

    private static final Logger log = LoggerFactory.getLogger(Slf4jFrontendLogWriter.class);

    @Override
    public void write(FrontendLog frontendLog) {
        log.info(
                "[FE-LOG] event: {}, message: {}, timestamp: {}",
                frontendLog.event(),
                frontendLog.message(),
                frontendLog.timestamp());
    }
}
