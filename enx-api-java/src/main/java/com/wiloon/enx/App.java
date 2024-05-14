package com.wiloon.enx;

import org.jdbi.v3.core.Jdbi;

/**
 * Hello world!
 *
 */
public class App {
    public static void main(String[] args) {
        System.out.println("Hello World!");
        Jdbi jdbi = Jdbi.create("jdbc:sqlite:/var/lib/enx-api/enx.db");
        String en = jdbi.withHandle(handle -> {
            // Easy mapping to any type
            return handle.createQuery("SELECT english FROM words where id=:id")
                    .bind("id", 74).mapTo(String.class).one();
        });
        System.out.println(en);
    }
}