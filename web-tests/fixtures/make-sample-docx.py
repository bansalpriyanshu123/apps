"""Builds web-tests/fixtures/sample.docx with the standard library only (a .docx is a zip of XML files).

Contents: a heading, Hindi and English paragraphs, abbreviations (उदा:, Ex.), an automatically numbered list, a 2x2 table, and 44 numbered paragraphs so
the viewer has to split the file into several parts. Run: python web-tests/fixtures/make-sample-docx.py
"""
import os
import zipfile
from xml.sax.saxutils import escape

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sample.docx')
NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def p(text, style=None):
    props = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ''
    return f'<w:p>{props}<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'


def item(text):
    """A paragraph of an automatically numbered Word list: the number is not in the text."""
    return ('<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
            f'<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>')


def cell(text):
    return f'<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>{p(text)}</w:tc>'


body = [
    p('भारतीय राजव्यवस्था (नमूना)', 'Heading1'),
    p('भारत एक संघीय गणराज्य है। संविधान सर्वोच्च विधि है। यहाँ कार्यपालिका, विधायिका और न्यायपालिका तीन अंग हैं।'),
    p('The Constitution came into force on 26 January 1950. It is the supreme law of the land.'),
    p('प्रतिस्पर्धी संघवाद में राज्य एक-दूसरे से प्रतिस्पर्धा करते हैं, जबकि सहकारी संघवाद में वे मिलकर काम करते हैं।'),
    '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>'
    '<w:tr>' + cell('अंग') + cell('कार्य') + '</w:tr><w:tr>' + cell('विधायिका') + cell('कानून बनाना।') + '</w:tr></w:tbl>',
]
body += [
    p('उदा: संघवाद का एक उदाहरण भारत है।'),
    p('Ex. The United States is a federation.'),
    item('पहला बिंदु: संविधान लिखित है।'),
    item('दूसरा बिंदु: संविधान में संशोधन संभव है।'),
    item('तीसरा बिंदु: न्यायपालिका स्वतंत्र है।'),
]
body += [p(f'{n}. यह परीक्षण का अनुच्छेद संख्या {n} है। इसमें दो वाक्य हैं।') for n in range(1, 45)]

document = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS}><w:body>' + ''.join(body)
            + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>')

styles = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {NS}>'
          '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
          '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style></w:styles>')

numbering = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering {NS}>'
             '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>'
             '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl>'
             '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>')

content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                 '<Default Extension="xml" ContentType="application/xml"/>'
                 '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                 '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                 '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
                 '</Types>')

root_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
             '</Relationships>')

doc_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
            '</Relationships>')

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', content_types)
    z.writestr('_rels/.rels', root_rels)
    z.writestr('word/document.xml', document)
    z.writestr('word/styles.xml', styles)
    z.writestr('word/numbering.xml', numbering)
    z.writestr('word/_rels/document.xml.rels', doc_rels)
print('wrote', OUT, os.path.getsize(OUT), 'bytes')
