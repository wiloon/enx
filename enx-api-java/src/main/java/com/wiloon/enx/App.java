package com.wiloon.enx;

import java.util.List;

import org.jdbi.v3.core.Jdbi;
import org.jdbi.v3.sqlobject.SqlObjectPlugin;

public class App {
    public static void main(String[] args) {
        Jdbi jdbi = Jdbi.create("jdbc:sqlite:/var/lib/enx-api/enx.db");
        String en = jdbi.withHandle(handle -> {
            // Easy mapping to any type
            return handle.createQuery("SELECT english FROM words where id=:id and english=:english")
                    .bind("id", 74)
                    .bind("english", "a")
                    .mapTo(String.class)
                    .one();
        });
        System.out.println(en);

        // declarative api
        jdbi.installPlugin(new SqlObjectPlugin());
        List<WordBean> words = jdbi.withExtension(WordDao.class, dao -> {
            return dao.listWords();
        });
        for (WordBean word : words){
            System.out.println(word.getEnglish());
        }
    }
}
