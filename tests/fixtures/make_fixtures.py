#!/usr/bin/env python3
"""Regenerate the test PDFs (needs reportlab and pypdf). Usually not needed: the PDFs are committed."""
import os
import sys
from reportlab.lib.pagesizes import letter, landscape
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter
out = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
c = canvas.Canvas(out + '/worksheet.pdf', pagesize=letter)
for i in range(3):
    c.setFont('Helvetica-Bold', 28); c.drawString(72, 720, f'Worksheet page {i+1}')
    c.setFont('Helvetica', 14)
    for k in range(12):
        y = 660 - k * 48
        c.drawString(72, y, f'{k+1}. Question text that a highlighter should cover nicely.')
        c.line(72, y - 20, 540, y - 20)
    c.rect(72, 60, 468, 20)
    c.showPage()
c.save()
c = canvas.Canvas(out + '/book_raw.pdf', pagesize=letter)
N = 320
for i in range(N):
    if i == 10: c.setPageSize(landscape(letter))
    elif i == 11: c.setPageSize(letter)
    w, h = c._pagesize
    ch = i // 20 + 1
    if i % 20 == 0:
        c.bookmarkPage(f'ch{ch}'); c.addOutlineEntry(f'Chapter {ch}: Topic {ch}', f'ch{ch}', level=0)
    if i % 20 == 10:
        c.bookmarkPage(f'ch{ch}s'); c.addOutlineEntry(f'Section {ch}.2', f'ch{ch}s', level=1)
    c.setFont('Helvetica-Bold', 36); c.drawString(72, h - 100, f'Page {i+1}')
    c.setFont('Helvetica', 12)
    for k in range(30): c.drawString(72, h - 150 - k * 18, f'Line {k+1} of page {i+1}, chapter {ch}. Lorem ipsum dolor sit amet.')
    c.showPage()
c.showOutline(); c.save()
r = PdfReader(out + '/book_raw.pdf'); wtr = PdfWriter(clone_from=r)
wtr.pages[12].rotate(90)   # page 13 shown rotated
wtr.write(out + '/book.pdf')
os.remove(out + '/book_raw.pdf')
print('ok', len(r.pages))

# links.pdf: like an OCR'd scan (page image + invisible text), a contents page with internal links,
# an external link, a landscape page and a rotated page.
c = canvas.Canvas(out + '/links_raw.pdf', pagesize=letter, invariant=1)
def ocr_text(c, x, y, s, size=14):
    t = c.beginText(x, y); t.setTextRenderMode(3); t.setFont('Helvetica', size); t.textLine(s); c.drawText(t)
c.setFont('Helvetica-Bold', 28); c.drawString(72, 720, 'Contents')
c.setFont('Helvetica', 16)
for i, y in enumerate([660, 620, 580]):
    c.drawString(90, y, f'Chapter {i+1} ........ page {i+2}')
    c.linkRect('', f'p{i+2}', (86, y - 6, 400, y + 18), relative=0)
c.drawString(90, 500, 'Website: example.org')
c.linkURL('https://example.org/overboard', (86, 494, 300, 518), relative=0)
c.showPage()
for i in range(3):
    if i == 1: c.setPageSize(landscape(letter))
    else: c.setPageSize(letter)
    w, h = c._pagesize
    c.bookmarkPage(f'p{i+2}')
    c.setFillGray(0.2); c.rect(60, h - 130, 300, 50, fill=1, stroke=0); c.setFillGray(0)   # the "scanned" heading
    ocr_text(c, 72, h - 110, f'Scanned heading {i+2}', 24)
    for k in range(10): ocr_text(c, 72, h - 170 - k * 24, f'Answer key line {k+1}: photosynthesis {i+2}x{k+1}')
    c.showPage()
c.save()
r = PdfReader(out + '/links_raw.pdf'); wtr = PdfWriter(clone_from=r)
wtr.pages[3].rotate(90)   # page 4 shown rotated
wtr.write(out + '/links.pdf')
os.remove(out + '/links_raw.pdf')
print('ok links', len(r.pages))
