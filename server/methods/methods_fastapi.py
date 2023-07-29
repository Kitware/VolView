import sys
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from volview_server import VolViewApi

# Import the VolView Methods API
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from methods_api import volview


app = FastAPI()

# Adds volview middlware
app.add_middleware(volview)

# Set CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
)


@app.get("/")
def index():
    return {"hello": "world"}
