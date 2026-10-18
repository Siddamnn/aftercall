from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from aftercall import api
from aftercall.config import get_settings

SITE = "https://aftercall-demo.web.app"


def guarded_app() -> TestClient:
    app = FastAPI()

    @app.post("/thing")
    def thing() -> dict[str, bool]:
        return {"ran": True}

    app.add_middleware(CORSMiddleware, allow_origins=[SITE], allow_methods=["POST"], allow_headers=["Content-Type"])
    app.add_middleware(api.OriginGuard, origins=[SITE])
    return TestClient(app)


def test_the_own_site_is_served_with_cors_headers():
    res = guarded_app().post("/thing", headers={"Origin": SITE})
    assert res.status_code == 200 and res.headers["access-control-allow-origin"] == SITE


def test_another_site_is_refused_before_anything_runs():
    res = guarded_app().post("/thing", headers={"Origin": "https://evil.example"})
    assert res.status_code == 403 and "access-control-allow-origin" not in res.headers


def test_another_sites_preflight_is_refused():
    res = guarded_app().options("/thing", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert res.status_code == 403


def test_requests_without_an_origin_pass_to_their_own_auth():
    assert guarded_app().post("/thing").json() == {"ran": True}


def test_origins_are_read_with_commas_or_spaces(monkeypatch):
    monkeypatch.setattr(get_settings(), "cors_origins", f"{SITE}/, https://b.firebaseapp.com  https://c.example")
    assert api.allowed_origins() == [SITE, "https://b.firebaseapp.com", "https://c.example"]
