"""Pay emails: once a week is paid, each contractor can be emailed their pay for it
(Peter: subject with the pay and the dates; body with every client, date and amount,
then deductions and the total). Sent through GHL Conversations, so each email also
shows in the contractor's GHL conversation."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.utils.html import escape

from hub.models import HubPayEmail, HubPayWeek, HubUser
from hub.services import contractor_pay as pay
from hub.services import ghl

ZERO = Decimal("0")


def _day(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d:%a, %b} {d.day}"


def _range(ws: date) -> str:
    we = ws + timedelta(days=6)
    return f"{ws:%b} {ws.day} – {we:%b} {we.day}, {we.year}"


def money(value: Decimal) -> str:
    value = value + ZERO  # never "-$0.00"
    return f"-${-value:,.2f}" if value < 0 else f"${value:,.2f}"


def paid_week(ws: date) -> HubPayWeek:
    week = HubPayWeek.objects.filter(week_start=ws).first()
    if week is None:
        raise pay.PayError("Mark the week paid before sending pay emails.")
    return week


def _week_rows(ws: date) -> list[dict]:
    return [r for r in pay.build_rows(ws, ws + timedelta(days=6)) if r["status"] == "active"]


def statement(rows: list[dict]) -> dict:
    """One contractor's week: visit lines (pay + tip), late adjustments, deductions, total."""
    visits: dict[str, dict] = {}
    adjustments, deductions = [], []
    for r in rows:
        amount = Decimal(r["amount_paid"])
        if r["type"] in ("pay", "tip"):
            line = visits.setdefault(
                r["visit_id"],
                {"date": r["date"], "client": r.get("client_name") or "", "pay": ZERO, "tip": ZERO},
            )
            line["pay" if r["type"] == "pay" else "tip"] += amount
        elif r["type"] == "adjustment":
            adjustments.append(
                {"date": r["date"], "client": r.get("client_name") or "", "note": r.get("note") or "", "amount": amount}
            )
        else:
            label = "Supplies" if r["type"] == "supplies_deduction" else "Restock"
            deductions.append({"date": r["date"], "label": label, "note": r.get("note") or "", "amount": amount})
    lines = sorted(
        (l for l in visits.values() if l["pay"] or l["tip"]), key=lambda l: (l["date"], l["client"])
    )
    for line in lines:
        line["total"] = line["pay"] + line["tip"]
    total = sum((Decimal(r["amount_paid"]) for r in rows), ZERO)
    return {"lines": lines, "adjustments": adjustments, "deductions": deductions, "total": total}


def _render(name: str, ws: date, st: dict) -> tuple[str, str, str]:
    subject = f"Your pay for {_range(ws)}: {money(st['total'])}"
    first = (name or "").split(" ")[0] or "there"
    td = 'style="padding:6px 10px;border-bottom:1px solid #eee"'
    tdr = 'style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right"'
    th = 'style="padding:6px 10px;border-bottom:2px solid #ccc;text-align:left"'
    thr = 'style="padding:6px 10px;border-bottom:2px solid #ccc;text-align:right"'

    has_tips = any(l["tip"] for l in st["lines"])
    rows_html = "".join(
        f"<tr><td {td}>{_day(l['date'])}</td><td {td}>{escape(l['client'])}</td>"
        f"<td {tdr}>{money(l['pay'])}</td>"
        + (f"<td {tdr}>{money(l['tip']) if l['tip'] else ''}</td>" if has_tips else "")
        + f"<td {tdr}>{money(l['total'])}</td></tr>"
        for l in st["lines"]
    )
    cols = 5 if has_tips else 4
    head = (
        f"<tr><th {th}>Date</th><th {th}>Client</th><th {thr}>Pay</th>"
        + (f"<th {thr}>Tip</th>" if has_tips else "")
        + f"<th {thr}>Amount</th></tr>"
    )
    extra = []
    for a in st["adjustments"]:
        what = "Adjustment" + (f": {a['client']}" if a["client"] else "") + (f" ({a['note']})" if a["note"] else "")
        extra.append((_day(a["date"]), what, a["amount"]))
    for d in st["deductions"]:
        what = d["label"] + (f": {d['note']}" if d["note"] and d["label"] == "Restock" else "")
        extra.append((_day(d["date"]), what, d["amount"]))
    extra_html = "".join(
        f"<tr><td {td}>{day}</td><td {td} colspan=\"{cols - 2}\">{escape(what)}</td><td {tdr}>{money(amt)}</td></tr>"
        for day, what, amt in extra
    )
    visits_html = (
        f'<table style="border-collapse:collapse;width:100%;max-width:640px;font-size:14px">'
        f"<thead>{head}</thead><tbody>{rows_html}</tbody></table>"
        if st["lines"]
        else "<p>No visits this week.</p>"
    )
    other_html = (
        f'<h3 style="margin:20px 0 6px;font-size:15px">Adjustments and deductions</h3>'
        f'<table style="border-collapse:collapse;width:100%;max-width:640px;font-size:14px"><tbody>{extra_html}</tbody></table>'
        if extra
        else ""
    )
    html = (
        '<div style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.4">'
        f"<p>Hi {escape(first)},</p>"
        f"<p>Here is your pay for <strong>{_range(ws)}</strong>.</p>"
        f'<h3 style="margin:20px 0 6px;font-size:15px">Visits</h3>{visits_html}{other_html}'
        f'<p style="font-size:16px;margin-top:20px"><strong>Total: {money(st["total"])}</strong></p>'
        "<p>If anything looks wrong, just reply to this email.</p>"
        "<p>Thank you,<br>Clean on the Go</p></div>"
    )

    text = [f"Hi {first},", f"Here is your pay for {_range(ws)}.", ""]
    text += [f"{_day(l['date'])}  {l['client']}  {money(l['total'])}" for l in st["lines"]]
    text += [f"{day}  {what}  {money(amt)}" for day, what, amt in extra]
    text += ["", f"Total: {money(st['total'])}"]
    return subject, html, "\n".join(text)


def week_overview(ws: date) -> list[dict]:
    """Everyone with pay lines in the week, with their total and email status."""
    by_contractor: dict[str, list[dict]] = defaultdict(list)
    for r in _week_rows(ws):
        by_contractor[r["contractor_id"]].append(r)
    users = {str(u.id): u for u in HubUser.objects.filter(id__in=list(by_contractor))}
    sent: dict[str, list[HubPayEmail]] = defaultdict(list)
    for e in HubPayEmail.objects.filter(week_id=ws).select_related("sent_by"):
        sent[str(e.contractor_id)].append(e)

    out = []
    for cid, rows in by_contractor.items():
        user = users.get(cid)
        if user is None:
            continue
        attempts = sent.get(cid, [])  # newest first (model ordering)
        last_ok = next((e for e in attempts if e.ok), None)
        last = attempts[0] if attempts else None
        out.append(
            {
                "contractor_id": cid,
                "contractor_name": user.name,
                "email": user.email or "",
                "total": pay._s(statement(rows)["total"]),
                "sent_at": last_ok.created_at.isoformat() if last_ok else None,
                "sent_by": last_ok.sent_by.name if last_ok and last_ok.sent_by else None,
                "sent_to": last_ok.to_email if last_ok else None,
                "last_failed": bool(last and not last.ok),
            }
        )
    return sorted(out, key=lambda c: c["contractor_name"])


def build_email(ws: date, contractor: HubUser) -> dict:
    paid_week(ws)
    rows = [r for r in _week_rows(ws) if r["contractor_id"] == str(contractor.id)]
    if not rows:
        raise pay.PayError(f"{contractor.name} has no pay this week.")
    st = statement(rows)
    subject, html, text = _render(contractor.name, ws, st)
    return {
        "to": contractor.email or "",
        "from": settings.GHL_PAY_EMAIL_FROM,
        "subject": subject,
        "html": html,
        "text": text,
        "total": st["total"],
    }


def send(ws: date, contractor: HubUser, request=None, *, test: bool = False) -> HubPayEmail | None:
    """Send the pay email. test=True sends it to the signed-in admin instead and
    records nothing. Raises PayError when it can't be sent."""
    email = build_email(ws, contractor)
    me = pay.actor(request)
    to = (me.email if me else "") if test else email["to"]
    if not to:
        raise pay.PayError(
            "Your Hub user has no email address." if test else f"{contractor.name} has no email address in the Hub."
        )
    subject = f"[Test] {email['subject']}" if test else email["subject"]
    ok = ghl.send_conversation_email(
        email=to,
        subject=subject,
        html=email["html"],
        message=email["text"],
        name=(me.name if me else "") if test else contractor.name,
        email_from=email["from"],
    )
    if test:
        if not ok:
            raise pay.PayError("GHL didn't accept the email. Check the server log.")
        return None
    record = HubPayEmail.objects.create(
        week_id=ws,
        contractor=contractor,
        to_email=to,
        subject=subject[:255],
        total=email["total"],
        ok=ok,
        sent_by=me,
    )
    if not ok:
        raise pay.PayError(f"GHL didn't accept the email to {contractor.name}. Check the server log.")
    pay.log_change(
        request,
        "pay_email.sent",
        {"week_start": ws, "contractor": contractor.name, "to": to, "total": pay._s(email["total"])},
    )
    return record
