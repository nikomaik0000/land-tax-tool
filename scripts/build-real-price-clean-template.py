from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "reference/government-forms/實價登錄委托書.pdf"
OUTPUT = ROOT / "reference/government-forms/實價登錄委托書-自訂標的區.pdf"


reader = PdfReader(SOURCE)
writer = PdfWriter(clone_from=SOURCE)
page = writer.pages[0]
content = ContentStream(reader.pages[0].get_contents(), reader)

example_start = next(
    index
    for index, (operands, operator) in enumerate(content.operations)
    if operator == b"g" and operands and abs(float(operands[0]) - 0.498) < 0.001
)
example_end = next(
    index
    for index, (operands, operator) in enumerate(content.operations[example_start + 1 :], example_start + 1)
    if operator == b"g" and operands and abs(float(operands[0]) - 0.349) < 0.001
)

# The official city/district row is a self-contained marked-content block. It
# starts immediately after the gray example block and ends before the next text
# object (the official "委託辦理事項如下" paragraph). Removing the source
# operators avoids a white mask and keeps the official source PDF unchanged.
city_row_start = next(
    index
    for index, (_, operator) in enumerate(content.operations[example_end:], example_end)
    if operator == b"BDC"
)
city_underline_end = max(
    index
    for index, (operands, operator) in enumerate(content.operations[city_row_start + 1 :], city_row_start + 1)
    if operator == b"re"
    and len(operands) == 4
    and 600 <= float(operands[1]) <= 603
    and float(operands[2]) >= 50
)
city_row_end = next(
    index
    for index, (_, operator) in enumerate(content.operations[city_underline_end + 1 :], city_underline_end + 1)
    if operator == b"BT"
)

content.operations = (
    content.operations[:example_start]
    + content.operations[example_end:city_row_start]
    + content.operations[city_row_end:]
)
page.replace_contents(content)

with OUTPUT.open("wb") as stream:
    writer.write(stream)

print(OUTPUT)
