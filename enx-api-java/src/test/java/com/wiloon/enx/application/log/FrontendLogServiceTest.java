package com.wiloon.enx.application.log;

import static org.mockito.Mockito.verify;

import com.wiloon.enx.domain.log.FrontendLog;
import com.wiloon.enx.domain.log.FrontendLogWriter;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class FrontendLogServiceTest {

    @Mock
    private FrontendLogWriter frontendLogWriter;

    @InjectMocks
    private FrontendLogService frontendLogService;

    @Test
    void record_delegatesToWriter() {
        FrontendLog log = new FrontendLog("event", "message", "timestamp");

        frontendLogService.record(log);

        verify(frontendLogWriter).write(log);
    }
}
