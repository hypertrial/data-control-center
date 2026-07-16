from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from app.config import Settings
from app.services.registry import DatasetRegistry
from app.services.relationships import (
    RelationshipService,
    _cardinality,
    _has_key_name_signal,
    _type_family,
    _verification_verdict,
    relationship_id_for,
)
from app.services.workspace import Workspace


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        workspace_db_path=tmp_path / "workspace.duckdb",
        allow_arbitrary_registration_paths=True,
    )


def _profile(*columns: tuple[str, str, float], keys: list[str] | None = None) -> dict:
    return {
        "column_profiles": [
            {
                "name": name,
                "physical_type": physical_type,
                "semantic_type": "id_like" if name.endswith("id") else "categorical",
                "unique_pct": unique_pct,
                "metric_scope": "full",
            }
            for name, physical_type, unique_pct in columns
        ],
        "primary_grain_key_columns": keys or [],
        "entity_id_columns": [],
    }


def _relationship_workspace(tmp_path: Path):
    settings = _settings(tmp_path)
    workspace = Workspace(settings)
    customers = tmp_path / "customers.csv"
    orders = tmp_path / "orders.csv"
    customers.write_text("customer_id,name\n1,A\n2,B\n", encoding="utf-8")
    orders.write_text("order_id,customer_id\n10,1\n11,1\n12,2\n", encoding="utf-8")
    registry = DatasetRegistry(workspace, settings)
    left = registry.register_path(customers)
    right = registry.register_path(orders)
    workspace.profiles.save_profile_cache(
        left.dataset_id,
        _profile(("customer_id", "BIGINT", 100.0), ("name", "VARCHAR", 100.0), keys=["customer_id"]),
    )
    workspace.profiles.save_profile_cache(
        right.dataset_id,
        _profile(("order_id", "BIGINT", 100.0), ("customer_id", "BIGINT", 66.67), keys=["order_id"]),
    )
    return settings, workspace, registry, left, right


def test_workspace_migrates_feature_tables_and_saved_chart_crud(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    workspace = Workspace(settings)
    workspace.close()
    con = duckdb.connect(str(settings.workspace_db_path))
    con.execute("DROP TABLE dcc_chart_artifacts")
    con.execute("DROP TABLE dcc_relationship_decisions")
    con.close()

    workspace = Workspace(settings)
    try:
        chart_id = workspace.saved_charts.insert_saved_chart(
            "ds_001", " Chart ", " note ", {"version": 4, "datasetId": "ds_001"}
        )
        row = workspace.saved_charts.get_saved_chart(chart_id)
        assert row and row["name"] == "Chart" and row["description"] == "note"
        assert workspace.saved_charts.list_saved_charts("other") == []
        assert workspace.saved_charts.count_for_dataset("ds_001") == 1
        assert workspace.saved_charts.update_saved_chart(
            chart_id, name="Updated", description="", spec={"version": 4, "datasetId": "ds_001", "x": 1}
        )
        assert workspace.saved_charts.get_saved_chart(chart_id)["description"] is None  # type: ignore[index]
        assert workspace.saved_charts.update_saved_chart("missing", name="x") is False
        assert workspace.saved_charts.delete_saved_chart("missing") is False
        disposable = workspace.saved_charts.insert_saved_chart(
            "ds_001", "Disposable", None, {"version": 4, "datasetId": "ds_001"}
        )
        assert workspace.saved_charts.delete_saved_chart(disposable) is True
        assert workspace.saved_charts.delete_for_dataset("ds_001") == 1
        assert workspace.saved_charts.get_saved_chart(chart_id) is None
    finally:
        workspace.close()


def test_saved_chart_http_crud_validation_and_dataset_cascade(client) -> None:
    uploaded = client.post(
        "/api/datasets/upload",
        files=[("files", ("sales.csv", b"amount\n1\n2\n", "text/csv"))],
    ).json()[0]
    dataset_id = uploaded["dataset_id"]
    spec = {"version": 4, "datasetId": dataset_id, "chartType": "histogram"}

    created = client.post(
        "/api/saved-charts",
        json={"dataset_id": dataset_id, "name": "Amounts", "description": "Demo", "spec": spec},
    )
    assert created.status_code == 201
    chart = created.json()
    assert client.get(f"/api/saved-charts?dataset_id={dataset_id}").json()[0]["name"] == "Amounts"

    patched = client.patch(
        f"/api/saved-charts/{chart['chart_id']}",
        json={"name": "Updated", "description": None, "spec": {**spec, "topN": 10}},
    )
    assert patched.status_code == 200 and patched.json()["description"] is None
    assert client.patch(f"/api/saved-charts/{chart['chart_id']}", json={}).status_code == 400
    assert client.patch(
        f"/api/saved-charts/{chart['chart_id']}", json={"name": None}
    ).status_code == 400
    assert client.patch(
        f"/api/saved-charts/{chart['chart_id']}", json={"spec": None}
    ).status_code == 400
    assert client.patch(
        f"/api/saved-charts/{chart['chart_id']}", json={"name": "   "}
    ).status_code == 400
    assert client.patch("/api/saved-charts/missing", json={"name": "x"}).status_code == 404
    assert client.post(
        "/api/saved-charts", json={"dataset_id": "missing", "name": "x", "spec": spec}
    ).status_code == 404
    assert client.post(
        "/api/saved-charts", json={"dataset_id": dataset_id, "name": "   ", "spec": spec}
    ).status_code == 400
    assert client.post(
        "/api/saved-charts",
        json={"dataset_id": dataset_id, "name": "x", "spec": {"version": 0, "datasetId": dataset_id}},
    ).status_code == 400

    orphan_id = client.app.state.workspace.saved_charts.insert_saved_chart(
        "missing", "Orphan", None, {"version": 4, "datasetId": "missing"}
    )
    assert client.patch(
        f"/api/saved-charts/{orphan_id}", json={"name": "Still orphaned"}
    ).status_code == 404
    assert client.app.state.workspace.saved_charts.delete_saved_chart(orphan_id)
    assert client.post(
        "/api/saved-charts",
        json={"dataset_id": dataset_id, "name": "x", "spec": {"version": 4, "datasetId": "other"}},
    ).status_code == 400
    assert client.patch(
        f"/api/saved-charts/{chart['chart_id']}",
        json={"spec": {"version": 4, "datasetId": "other"}},
    ).status_code == 400
    assert client.post(
        "/api/saved-charts",
        json={
            "dataset_id": dataset_id,
            "name": "x",
            "spec": {"version": 4, "datasetId": dataset_id, "padding": "x" * 500_000},
        },
    ).status_code == 400

    disposable = client.post(
        "/api/saved-charts",
        json={"dataset_id": dataset_id, "name": "Disposable", "spec": spec},
    ).json()
    assert client.delete(f"/api/saved-charts/{disposable['chart_id']}").status_code == 204

    deps = client.get(f"/api/datasets/{dataset_id}/dependencies").json()
    assert deps == {"saved_chart_count": 1, "relationship_decision_count": 0}
    assert client.get("/api/datasets/missing/dependencies").status_code == 404
    assert client.delete(f"/api/datasets/{dataset_id}").status_code == 204
    assert client.get("/api/saved-charts").json() == []
    assert client.delete(f"/api/saved-charts/{chart['chart_id']}").status_code == 404


def test_relationship_discovery_verification_decisions_and_stale_state(tmp_path: Path) -> None:
    settings, workspace, registry, left, right = _relationship_workspace(tmp_path)
    try:
        service = RelationshipService(registry, workspace, settings)
        response = service.list_relationships(left.dataset_id)
        assert response["pending_dataset_ids"] == []
        relationship = response["relationships"][0]
        assert relationship["cardinality"] == "one_to_many"
        assert relationship["confidence"] == "high"
        assert "INNER JOIN" in relationship["suggested_sql"]
        assert str(left.source_path) not in relationship["suggested_sql"]
        assert relationship_id_for(
            left.dataset_id, "customer_id", right.dataset_id, "customer_id"
        ) == relationship["relationship_id"]

        oriented = service.list_relationships(right.dataset_id)["relationships"][0]
        assert oriented["left"]["dataset_id"] == right.dataset_id
        assert oriented["cardinality"] == "many_to_one"

        workspace.profiles.save_profile_cache(
            left.dataset_id,
            _profile(("customer_id", "BIGINT", 50.0), keys=["customer_id"]),
        )
        workspace.profiles.save_profile_cache(
            right.dataset_id,
            _profile(("customer_id", "BIGINT", 100.0), keys=["customer_id"]),
        )
        reversed_cardinality = service.list_relationships(right.dataset_id)["relationships"][0]
        assert reversed_cardinality["cardinality"] == "one_to_many"
        workspace.profiles.save_profile_cache(
            left.dataset_id,
            _profile(("customer_id", "BIGINT", 100.0), keys=["customer_id"]),
        )
        workspace.profiles.save_profile_cache(
            right.dataset_id,
            _profile(
                ("order_id", "BIGINT", 100.0),
                ("customer_id", "BIGINT", 66.67),
                keys=["order_id"],
            ),
        )

        verification = service.verify(relationship["relationship_id"])
        assert verification["verdict"] == "strong"
        assert verification["overlap_distinct"] == 2

        confirmed = service.set_decision(relationship["relationship_id"], "confirmed")
        assert confirmed["decision"] == "confirmed"
        assert workspace.relationship_decisions.count_for_dataset(left.dataset_id) == 1
        service.set_decision(relationship["relationship_id"], "dismissed")
        assert service.list_relationships(left.dataset_id)["relationships"] == []
        assert service.list_relationships(left.dataset_id, include_dismissed=True)["relationships"][0]["decision"] == "dismissed"

        workspace.profiles.save_profile_cache(
            right.dataset_id, _profile(("order_id", "BIGINT", 100.0), keys=["order_id"])
        )
        stale = service.list_relationships(left.dataset_id, include_dismissed=True)["relationships"][0]
        assert stale["availability"] == "stale" and stale["suggested_sql"] is None
        with pytest.raises(LookupError, match="stale"):
            service.verify(stale["relationship_id"])
        assert workspace.relationship_decisions.delete_for_dataset(left.dataset_id) == 1
    finally:
        workspace.close()


def test_relationship_filters_pending_and_weak_candidates(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    workspace = Workspace(settings)
    try:
        registry = DatasetRegistry(workspace, settings)
        for filename, body in [
            ("a.csv", "id,user_id,name,status,amount,paid\n1,10,A,x,1,true\n2,20,B,y,2,false\n"),
            ("b.csv", "id,user_id,name,status,amount,paid\n1,10,A,x,3,true\n3,10,C,z,4,false\n"),
            ("pending.csv", "id\n1\n"),
        ]:
            (tmp_path / filename).write_text(body, encoding="utf-8")
        a = registry.register_path(tmp_path / "a.csv")
        b = registry.register_path(tmp_path / "b.csv")
        pending = registry.register_path(tmp_path / "pending.csv")
        workspace.profiles.save_profile_cache(
            a.dataset_id,
            _profile(("id", "BIGINT", 100.0), ("user_id", "BIGINT", 100.0), ("name", "VARCHAR", 100.0), ("status", "VARCHAR", 100.0), ("amount", "BIGINT", 100.0), ("paid", "BOOLEAN", 100.0), ("low", "BIGINT", 10.0)),
        )
        workspace.profiles.save_profile_cache(
            b.dataset_id,
            _profile(("id", "VARCHAR", 100.0), ("user_id", "BIGINT", 50.0), ("name", "VARCHAR", 100.0), ("status", "VARCHAR", 50.0), ("amount", "BIGINT", 100.0), ("paid", "BOOLEAN", 100.0), ("low", "BIGINT", 10.0)),
        )
        workspace.relationship_decisions.upsert_decision(
            "unrelated", "removed-a", "id", "removed-b", "id", "confirmed"
        )
        response = RelationshipService(registry, workspace, settings).list_relationships(a.dataset_id)
        assert len(response["relationships"]) == 1
        assert response["relationships"][0]["confidence"] == "medium"
        assert response["relationships"][0]["left"]["column_name"] == "user_id"
        assert response["pending_dataset_ids"] == [pending.dataset_id]
        with pytest.raises(LookupError, match="Dataset not found"):
            RelationshipService(registry, workspace, settings).list_relationships("missing")
        with pytest.raises(LookupError, match="Relationship not found"):
            RelationshipService(registry, workspace, settings).get_relationship("missing")
    finally:
        workspace.close()


def test_relationship_http_flow(client) -> None:
    app = client.app
    registry = app.state.registry
    workspace = app.state.workspace
    root = Path(app.state.settings.workspace_db_path).parent
    customers = root / "customers.csv"
    orders = root / "orders.csv"
    customers.write_text("customer_id\n1\n2\n", encoding="utf-8")
    orders.write_text("order_id,customer_id\n1,1\n2,2\n", encoding="utf-8")
    left = registry.register_path(customers)
    right = registry.register_path(orders)
    workspace.profiles.save_profile_cache(
        left.dataset_id, _profile(("customer_id", "BIGINT", 100.0), keys=["customer_id"])
    )
    workspace.profiles.save_profile_cache(
        right.dataset_id,
        _profile(("order_id", "BIGINT", 100.0), ("customer_id", "BIGINT", 100.0), keys=["order_id"]),
    )

    listed = client.get(f"/api/relationships?dataset_id={left.dataset_id}")
    assert listed.status_code == 200
    relationship_id = listed.json()["relationships"][0]["relationship_id"]
    assert client.post(f"/api/relationships/{relationship_id}/verify").status_code == 200
    assert client.put(
        f"/api/relationships/{relationship_id}/decision", json={"status": "confirmed"}
    ).json()["decision"] == "confirmed"
    deps = client.get(f"/api/datasets/{left.dataset_id}/dependencies").json()
    assert deps["relationship_decision_count"] == 1
    assert client.delete(f"/api/relationships/{relationship_id}/decision").status_code == 204
    assert client.delete(f"/api/relationships/{relationship_id}/decision").status_code == 404
    assert client.get("/api/relationships?dataset_id=missing").status_code == 404
    assert client.post("/api/relationships/missing/verify").status_code == 404
    assert client.put(
        "/api/relationships/missing/decision", json={"status": "confirmed"}
    ).status_code == 404


def test_relationship_type_families_and_cardinality_helpers() -> None:
    assert _has_key_name_signal("id")
    assert _has_key_name_signal("customer_id")
    assert _has_key_name_signal("customerId")
    assert not _has_key_name_signal("paid")
    assert _type_family("DATE") == "temporal"
    assert _type_family("TIMESTAMP") == "temporal"
    assert _type_family("BOOLEAN") == "boolean"
    assert _type_family("DECIMAL(18, 2)") == "number"
    assert _type_family("INTERVAL") == "INTERVAL"
    assert _type_family("BLOB") == "BLOB"
    assert _cardinality({"unique_pct": 10}, {"unique_pct": 100}) == "many_to_one"
    assert _cardinality({}, {}) == "unknown"


@pytest.mark.parametrize(
    ("left_pct", "right_pct", "overlap", "expected"),
    [
        (80.0, 100.0, 8, "strong"),
        (20.0, 75.0, 2, "partial"),
        (0.01, 10.0, 1, "weak"),
        (0.0, 0.0, 0, "no_overlap"),
    ],
)
def test_relationship_verdict_thresholds(
    left_pct: float, right_pct: float, overlap: int, expected: str
) -> None:
    assert _verification_verdict(left_pct, right_pct, overlap) == expected


@pytest.mark.parametrize(
    ("message", "status", "public_message"),
    [
        (
            'IO Error: No files found that match the pattern "/private/secret.csv"',
            400,
            "Dataset source file is unavailable",
        ),
        ("Query timeout exceeded", 408, "Relationship verification timed out"),
        ("Conversion error at /private/secret.csv", 400, "Unable to verify relationship"),
    ],
)
def test_relationship_verification_sanitizes_duckdb_errors(
    client, monkeypatch: pytest.MonkeyPatch, message: str, status: int, public_message: str
) -> None:
    def fail(*_args, **_kwargs):
        raise duckdb.Error(message)

    monkeypatch.setattr(RelationshipService, "verify", fail)
    response = client.post("/api/relationships/relationship/verify")
    assert response.status_code == status
    assert public_message in response.json()["error"]["message"]
    assert "/private/secret.csv" not in response.text
