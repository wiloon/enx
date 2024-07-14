package com.wiloon.enx.order;

import java.security.SecureRandom;
import java.util.UUID;
import java.util.function.Consumer;

import org.jdbi.v3.core.Jdbi;
import com.wiloon.enx.support.DatabaseSupport;

public final class OrderSupport {
    private static final SecureRandom RANDOM = new SecureRandom();

    private OrderSupport() {
        throw new AssertionError("OrderSupport can not be instantiated");
    }

    public static void withOrders(Consumer<Jdbi> jdbiConsumer) throws Exception {
        DatabaseSupport.withDatabase(jdbi -> {
            createTables(jdbi);
            populateOrders(jdbi, 3, 20);

            jdbi.registerRowMapper(new OrderMapper());

            jdbiConsumer.accept(jdbi);
        });
    }

    public static void createTables(Jdbi jdbi) {
        jdbi.withHandle(
            handle -> handle.execute("CREATE TABLE orders (id INT, user_id INT, comment VARCHAR, address VARCHAR)"));
    }

    public static void populateOrders(Jdbi jdbi, int orderCount, int userIdCount) {
        jdbi.withHandle(
            handle -> {
                for (int j = 0; j < userIdCount; j++) {
                    int userId = RANDOM.nextInt(10_000);
                    for (int i = 0; i < orderCount; i++) {
                        handle.createUpdate("INSERT INTO orders (id, user_id, comment, address) VALUES (:id, :user_id, :comment, :address)")
                            .bind("id", RANDOM.nextInt(1_000_000))
                            .bind("user_id", userId)
                            .bind("comment", UUID.randomUUID().toString().substring(0, 5))
                            .bind("address", UUID.randomUUID().toString().substring(0, 5))
                            .execute();
                    }
                }
                return null;
            });
    }
}