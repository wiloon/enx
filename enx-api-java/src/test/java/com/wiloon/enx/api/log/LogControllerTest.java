package com.wiloon.enx.api.log;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.wiloon.enx.application.log.FrontendLogService;
import com.wiloon.enx.infrastructure.config.CorsConfig;
import com.wiloon.enx.infrastructure.config.SecurityConfig;
import com.wiloon.enx.infrastructure.config.TestJwtDecoderConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(LogController.class)
@ActiveProfiles("test")
@Import({TestJwtDecoderConfig.class, SecurityConfig.class, CorsConfig.class})
class LogControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private FrontendLogService frontendLogService;

    @Test
    void postLog_withJwt_returnsSuccess() throws Exception {
        mockMvc.perform(post("/api/log")
                        .with(jwt().jwt(builder -> builder
                                .subject("sub-1")
                                .claim("client_id", "test-ui-client")
                                .claim("token_use", "access")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                """
                                {"event":"popup_open","message":"hello","timestamp":"2026-06-21T00:00:00Z"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    void postLog_withoutJwt_returnsUnauthorized() throws Exception {
        mockMvc.perform(post("/api/log")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                """
                                {"event":"popup_open","message":"hello","timestamp":"2026-06-21T00:00:00Z"}
                                """))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void postLog_withInvalidJson_returnsBadRequest() throws Exception {
        mockMvc.perform(post("/api/log")
                        .with(jwt())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("not-json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("Invalid log request"));
    }

    @Test
    void optionsLog_withChromeExtensionOrigin_returnsCorsHeaders() throws Exception {
        mockMvc.perform(options("/api/log")
                        .header("Origin", "chrome-extension://abcdefghijklmnop")
                        .header("Access-Control-Request-Method", "POST")
                        .header("Access-Control-Request-Headers", "Authorization, Content-Type"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "chrome-extension://abcdefghijklmnop"));
    }
}
