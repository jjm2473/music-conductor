cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m app.main --host 127.0.0.1 --port 8000 &

cd ../frontend
npm install
npm run dev
