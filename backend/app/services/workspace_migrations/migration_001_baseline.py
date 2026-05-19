"""Baseline workspace schema (all current dcc_* tables and indexes)."""

from __future__ import annotations

import duckdb


def upgrade(con: duckdb.DuckDBPyConnection) -> None:
    con.execute(
        """
        CREATE TABLE dcc_datasets (
          dataset_id VARCHAR PRIMARY KEY,
          source_path VARCHAR NOT NULL,
          source_label VARCHAR NOT NULL,
          view_name VARCHAR NOT NULL,
          format VARCHAR NOT NULL,
          row_count BIGINT,
          column_count INTEGER,
          file_size_bytes BIGINT,
          registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    con.execute(
        """
        CREATE UNIQUE INDEX dcc_datasets_view_name_unique
        ON dcc_datasets (view_name);
        """
    )
    con.execute(
        """
        CREATE TABLE dcc_profile_cache (
          dataset_id VARCHAR PRIMARY KEY,
          profile_json VARCHAR NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    con.execute(
        """
        CREATE TABLE dcc_jobs (
          job_id VARCHAR PRIMARY KEY,
          kind VARCHAR NOT NULL,
          dataset_id VARCHAR,
          status VARCHAR NOT NULL,
          progress DOUBLE DEFAULT 0,
          error_code VARCHAR,
          error_message VARCHAR,
          result_json VARCHAR,
          cancel_requested BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          finished_at TIMESTAMP
        );
        """
    )
    con.execute(
        """
        CREATE TABLE dcc_profile_history (
          history_id VARCHAR PRIMARY KEY,
          dataset_id VARCHAR NOT NULL,
          profile_json VARCHAR NOT NULL,
          quality_score DOUBLE,
          rows BIGINT,
          columns INTEGER,
          missing_cell_pct DOUBLE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    con.execute(
        """
        CREATE INDEX dcc_profile_history_ds_created
        ON dcc_profile_history (dataset_id, created_at DESC);
        """
    )
    con.execute(
        """
        CREATE TABLE dcc_saved_queries (
          saved_id VARCHAR PRIMARY KEY,
          name VARCHAR NOT NULL,
          sql VARCHAR NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    con.execute(
        """
        CREATE TABLE dcc_ask_conversations (
          conversation_id VARCHAR PRIMARY KEY,
          title VARCHAR NOT NULL,
          dataset_ids VARCHAR,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    con.execute(
        """
        CREATE TABLE dcc_ask_turns (
          turn_id VARCHAR PRIMARY KEY,
          conversation_id VARCHAR NOT NULL,
          seq INTEGER NOT NULL,
          question VARCHAR NOT NULL,
          sql VARCHAR,
          explanation VARCHAR,
          answer VARCHAR,
          error VARCHAR,
          attempts_json VARCHAR,
          result_json VARCHAR,
          model VARCHAR,
          elapsed_ms INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    con.execute(
        """
        CREATE INDEX dcc_ask_turns_conv_seq
        ON dcc_ask_turns (conversation_id, seq);
        """
    )
