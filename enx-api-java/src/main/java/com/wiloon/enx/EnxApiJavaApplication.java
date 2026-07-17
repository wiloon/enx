package com.wiloon.enx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class EnxApiJavaApplication {

    public static void main(String[] args) {
        SpringApplication.run(EnxApiJavaApplication.class, args);
    }
}
