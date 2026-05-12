import os
from flask import Flask
from flask_cors import CORS
from routes.scans import scans_bp
from routes.annotations import annotations_bp

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def create_app():
    app = Flask(__name__)
    CORS(app)

    app.config["DATA_DIR"] = os.path.join(BASE_DIR, "data")
    app.config["ANNOTATIONS_DIR"] = os.path.join(BASE_DIR, "annotations")

    os.makedirs(app.config["DATA_DIR"], exist_ok=True)
    os.makedirs(app.config["ANNOTATIONS_DIR"], exist_ok=True)

    app.register_blueprint(scans_bp, url_prefix="/api/scans")
    app.register_blueprint(annotations_bp, url_prefix="/api/annotations")

    @app.route("/api/health")
    def health():
        return {"status": "ok"}

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=5001, debug=True)
