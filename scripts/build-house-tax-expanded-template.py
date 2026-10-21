from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, FloatObject, NameObject


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT_ROOT / "reference/government-forms/申請房屋稅籍.pdf"
OUTPUT = PROJECT_ROOT / "reference/government-forms/申請房屋稅籍-動態代理人.pdf"
SPLIT_Y = 560
LOWER_SHIFT_Y = 42


def main():
    reader = PdfReader(SOURCE)
    if len(reader.pages) != 1:
        raise ValueError("房屋稅籍官方範本應為 1 頁")

    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    page = writer.pages[0]
    content = ContentStream(page.get_contents(), writer)
    content.operations = remove_fixed_authorization_phrase(content.operations)
    start = lower_block_start(content.operations)
    translate = [
        FloatObject(1), FloatObject(0), FloatObject(0),
        FloatObject(1), FloatObject(0), FloatObject(-LOWER_SHIFT_Y),
    ]
    content.operations = [
        *content.operations[:start],
        ([], b"q"),
        (translate, b"cm"),
        *content.operations[start:],
        ([], b"Q"),
    ]
    page[NameObject("/Contents")] = writer._add_object(content)
    with OUTPUT.open("wb") as stream:
        writer.write(stream)
    print(OUTPUT)


def remove_fixed_authorization_phrase(operations):
    """Keep the official wording, but let the overlay place it after the actual name."""
    phrase_gap_start = marked_content_start_for_text_matrix(operations, 152.95, 432.12)
    next_paragraph_start = marked_content_start_for_text_matrix(operations, 56.664, 396.12)
    if phrase_gap_start >= next_paragraph_start:
        raise ValueError("無法辨識政府範本的代理人句子範圍")
    return [*operations[:phrase_gap_start], *operations[next_paragraph_start:]]


def marked_content_start_for_text_matrix(operations, x, y):
    matrix_index = next(
        index for index, (operands, operator) in enumerate(operations)
        if operator == b"Tm"
        and len(operands) >= 6
        and abs(float(operands[4]) - x) < 0.01
        and abs(float(operands[5]) - y) < 0.01
    )
    for index in range(matrix_index, -1, -1):
        if operations[index][1] == b"BDC":
            return index
    raise ValueError("無法找到政府範本的標記內容區塊")


def lower_block_start(operations):
    first_lower_text = next(
        index for index, (operands, operator) in enumerate(operations)
        if operator == b"Tm" and len(operands) >= 6 and float(operands[5]) < SPLIT_Y
    )
    for index in range(first_lower_text, -1, -1):
        if operations[index][1] == b"BDC":
            return index
    raise ValueError("無法找到官方範本下半部的內容區塊")


if __name__ == "__main__":
    main()
