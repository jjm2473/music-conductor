from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from starlette.routing import Mount, Route

from app.config import AppConfig
from app.main import create_app


class MainStaticTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dist = Path(self.tmp.name) / "dist"
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "index.html").write_text("<html><body>ok</body></html>", encoding="utf-8")
        (self.dist / "assets" / "app.js").write_text("console.log('ok')", encoding="utf-8")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_mounts_frontend_static_files(self) -> None:
        app = create_app(AppConfig(), frontend_dist=self.dist)
        mounts = [route for route in app.router.routes if isinstance(route, Mount)]
        static_mount = next((route for route in mounts if route.name == "frontend"), None)
        self.assertIsNotNone(static_mount)

    def test_api_routes_still_registered_with_static_mount(self) -> None:
        app = create_app(AppConfig(), frontend_dist=self.dist)
        routes = [route for route in app.router.routes if isinstance(route, Route)]
        health_route = next((route for route in routes if route.path == "/api/health"), None)
        self.assertIsNotNone(health_route)


if __name__ == "__main__":
    unittest.main()
