def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_register_and_profile_csv(client, tmp_path):
    csv = tmp_path / "t.csv"
    csv.write_text("id,name,amount\n1,alice,10.5\n2,bob,20\n")
    r = client.post("/api/datasets/register-file", json={"path": str(csv)})
    assert r.status_code == 200, r.text
    did = r.json()["dataset_id"]
    pr = client.get(f"/api/datasets/{did}/profile")
    assert pr.status_code == 200, pr.text
    body = pr.json()
    assert body["rows"] == 2
    assert body["columns"] == 3


def test_sample_pagination(client, tmp_path):
    csv = tmp_path / "rows.csv"
    csv.write_text("a\n" + "\n".join(str(i) for i in range(30)))
    r = client.post("/api/datasets/register-file", json={"path": str(csv)})
    did = r.json()["dataset_id"]
    s1 = client.get(f"/api/datasets/{did}/sample?page=1&page_size=10")
    assert s1.status_code == 200
    assert len(s1.json()["rows"]) == 10


def test_sql_requires_view_reference(client, tmp_path):
    csv = tmp_path / "x.csv"
    csv.write_text("id\n1\n")
    client.post("/api/datasets/register-file", json={"path": str(csv)})
    r = client.post("/api/query", json={"sql": "SELECT 1"})
    assert r.status_code == 200
    body = r.json()
    assert body.get("error")
