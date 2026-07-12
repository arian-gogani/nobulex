FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
EXPOSE 7749
CMD ["gunicorn", "--bind", "0.0.0.0:7749", "--workers", "2", "server:app"]
