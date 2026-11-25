import Cocoa

// Draws the Nexus mark as an .iconset folder: one node routing to three lanes.
let out = CommandLine.arguments[1]
func png(_ px: Int) -> Data {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let s = CGFloat(px) / 1024
  let t = NSAffineTransform()
  t.scale(by: s)
  t.concat()
  let body = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 185, yRadius: 185)
  NSGradient(starting: NSColor(white: 0.13, alpha: 1), ending: .black)!.draw(in: body, angle: -90)
  NSColor(white: 1, alpha: 0.14).setStroke()
  body.lineWidth = 4
  body.stroke()
  NSColor.white.setStroke()
  NSColor.white.setFill()
  for y in [314.0, 512.0, 710.0] {
    let p = NSBezierPath()
    p.lineWidth = 46
    p.lineCapStyle = .round
    p.move(to: NSPoint(x: 320, y: 512))
    p.curve(to: NSPoint(x: 690, y: y), controlPoint1: NSPoint(x: 490, y: 512), controlPoint2: NSPoint(x: 480, y: y))
    p.stroke()
    NSBezierPath(ovalIn: NSRect(x: 650, y: y - 52, width: 104, height: 104)).fill()
  }
  NSBezierPath(ovalIn: NSRect(x: 248, y: 440, width: 144, height: 144)).fill()
  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}
for b in [16, 32, 128, 256, 512] {
  try! png(b).write(to: URL(fileURLWithPath: "\(out)/icon_\(b)x\(b).png"))
  try! png(b * 2).write(to: URL(fileURLWithPath: "\(out)/icon_\(b)x\(b)@2x.png"))
}
