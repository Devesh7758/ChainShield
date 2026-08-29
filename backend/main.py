import os
import json
import hashlib
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

app = FastAPI(title="ChainShield AI Core")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AuditResult(BaseModel):
    status: str
    invoice_hash: str
    claimed_amount: float
    allocated_limit: float
    risk_score: int
    risk_level: str
    anomaly_detected: bool
    issues: list[str]

@app.get("/")
def health_check():
    return {"status": "online", "service": "ChainShield Engine v1.0"}

@app.post("/api/audit", response_model=AuditResult)
async def audit_invoice(
    file: UploadFile = File(...),
    budget_limit: float = Form(40000.0)
):
    content = await file.read()
    file_hash = hashlib.sha256(content).hexdigest()

    model = genai.GenerativeModel("gemini-3.6-flash")
    
    prompt = f"""
    Analyze this financial document. The allocated budget limit is {budget_limit}.
    Extract the total claimed amount.
    Determine if there are any anomalies or if the amount exceeds the budget.
    Assign a risk score from 1 to 100.
    Assign a risk level (LOW, MEDIUM, HIGH).
    List any issues found.
    Respond ONLY with a valid JSON object matching this exact structure:
    {{
        "claimed_amount": 0.0,
        "risk_score": 0,
        "risk_level": "STRING",
        "anomaly_detected": false,
        "issues": ["issue 1", "issue 2"]
    }}
    """

    response = model.generate_content([
        {'mime_type': 'application/pdf', 'data': content},
        prompt
    ])

    try:
        ai_text = response.text.strip().replace("```json", "").replace("```", "")
        ai_data = json.loads(ai_text)
        
        extracted_amount = float(ai_data.get("claimed_amount", 0.0))
        
        return AuditResult(
            status="AUDITED",
            invoice_hash=file_hash,
            claimed_amount=extracted_amount,
            allocated_limit=budget_limit,
            risk_score=int(ai_data.get("risk_score", 0)),
            risk_level=str(ai_data.get("risk_level", "UNKNOWN")),
            anomaly_detected=bool(ai_data.get("anomaly_detected", False)),
            issues=ai_data.get("issues", [])
        )
    except Exception:
        return AuditResult(
            status="ERROR",
            invoice_hash=file_hash,
            claimed_amount=0.0,
            allocated_limit=budget_limit,
            risk_score=100,
            risk_level="HIGH",
            anomaly_detected=True,
            issues=["AI parsing failed"]
        )