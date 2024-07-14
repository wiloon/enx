package com.wiloon.enx.order;

import java.sql.ResultSet;
import java.sql.SQLException;

import org.jdbi.v3.core.mapper.RowMapper;
import org.jdbi.v3.core.statement.StatementContext;

public final class OrderMapper implements RowMapper<Order> {

    @Override
    public Order map(ResultSet rs, StatementContext ctx) throws SQLException {
        return new Order(
            rs.getInt("id"),
            rs.getInt("user_id"),
            rs.getString("comment"),
            rs.getString("address"));
    }
}
