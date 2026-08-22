from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import hashlib

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
    
    extracted_amount = 47500.0
    issues = []
    
    if extracted_amount > budget_limit:
        issues.append(f"Invoiced amount INR {extracted_amount} exceeds milestone allocation limit of INR {budget_limit}")
        issues.append("Quantity disparity: Invoiced 150 units against milestone cap of 100 units")
    
    return AuditResult(
        status="AUDITED",
        invoice_hash=file_hash,
        claimed_amount=extracted_amount,
        allocated_limit=budget_limit,
        risk_score=94,
        risk_level="HIGH",
        anomaly_detected=True,
        issues=issues
    )
