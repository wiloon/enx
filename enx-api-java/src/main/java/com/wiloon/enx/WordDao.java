package com.wiloon.enx;

import java.util.List;

import org.jdbi.v3.sqlobject.config.RegisterBeanMapper;
import org.jdbi.v3.sqlobject.statement.SqlQuery;

public interface WordDao {
    @SqlQuery("SELECT id,english,chinese,pronunciation FROM words")
    @RegisterBeanMapper(WordBean.class)
    List<WordBean> listWords();
}
