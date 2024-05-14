package com.wiloon.enx.support;

import java.util.function.Consumer;

import de.softwareforge.testing.postgres.embedded.DatabaseInfo;
import de.softwareforge.testing.postgres.embedded.DatabaseManager;
import de.softwareforge.testing.postgres.embedded.EmbeddedPostgres;
import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.postgres.PostgresPlugin;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;

public final class DatabaseSupport {

    private DatabaseSupport() {
        throw new AssertionError("DatabaseSupport can not be instantiated");
    }

    public static void withDatabase(Consumer<Jdbi> jdbiConsumer) throws Exception {
        try (DatabaseManager manager = DatabaseManager.singleDatabase()
            // same as EmbeddedPostgres.defaultInstance()
            .withInstancePreparer(EmbeddedPostgres.Builder::withDefaults)
            .build()
            .start()) {
            DatabaseInfo databaseInfo = manager.getDatabaseInfo();
            Jdbi jdbi = Jdbi.create(databaseInfo.asDataSource());
            jdbi.installPlugin(new SqlObjectPlugin())
                .installPlugin(new PostgresPlugin());

            jdbiConsumer.accept(jdbi);
        }
    }
}