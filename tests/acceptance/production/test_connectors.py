import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
def test_production_acquisition_kyb_and_communication_connectors():
    result=subprocess.run(["node","scripts/production-connector-contract.mjs"],cwd=ROOT,text=True,capture_output=True)
    assert result.returncode==0,result.stdout+result.stderr
    for claim in ("buyer_classification=SOURCE_STATED","unknown_value=UNKNOWN","brave=receipt_bound","kyb=verified","csl=clear","gmail_class=BUYER_RFQ","credit=declined","header_injection=blocked"):
        assert claim in result.stdout
