package com.wiloon.enx;

import java.sql.ResultSet;
import java.sql.SQLException;
import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;
public class WordMapper implements RowMapper<WordBean> {

    @Override
    public WordBean map(ResultSet rs, StatementContext ctx) throws SQLException {
        return new WordBean(
            rs.getInt("id"),
            rs.getString("english"),
            rs.getString("chinese"),
            rs.getString("pronunciation"));
    }
}
