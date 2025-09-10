This sidecar wraps JaxMARL’s MPE environments (starting with simple_spread) and exposes them to Tandem via FastAPI.

* Installation

1. Create and activate a Python environment

```
cd sidecar
conda create -n tandem python=3.10 -y
conda activate tandem
```

2. Install dependencies

```
pip install --upgrade pip
pip install -r requirements.txt
```

3. Clone and install JaxMARL (use source rather than pip package -- latest from Github)

```
cd ..
git clone https://github.com/FLAIROx/jaxmarl.git
cd jaxmarl
pip install -e .
```

* Running the sidecar

From inside the sidecar/ directory:

```
bash run.sh
```

You should see something like:

```
Uvicorn running on http://127.0.0.1:8001
```

This means that the sidecar is now live and serving endpoints.