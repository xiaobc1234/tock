const { test, assert } = require('./test-api.cjs')
const { dockBounds, nearestDock } = require('./dock.cjs')
const area = { x: -1300, y: 35, width: 1200, height: 810 }

test('expanded panel and collapsed strip dock to all four edges', () => {
  for (const [edge, point] of [
    ['left', { x: -1299, y: 440 }], ['right', { x: -101, y: 440 }],
    ['top', { x: -700, y: 36 }], ['bottom', { x: -700, y: 844 }],
  ]) {
    const panel = dockBounds(area, edge, 0.5, false)
    const strip = dockBounds(area, edge, 0.5, true)
    for (const bounds of [panel, strip]) assert.equal(nearestDock(area, point, bounds).edge, edge)
    if (edge === 'left') {
      assert.equal(strip.x, area.x)
      assert.equal(panel.x, area.x + 12)
    } else if (edge === 'right') {
      assert.equal(strip.x + strip.width, area.x + area.width)
      assert.equal(panel.x + panel.width, area.x + area.width - 12)
    } else if (edge === 'top') {
      assert.equal(strip.y, area.y)
      assert.equal(panel.y, area.y + 12)
    } else {
      assert.equal(strip.y + strip.height, area.y + area.height)
      assert.equal(panel.y + panel.height, area.y + area.height - 12)
    }
  }
  assert.deepEqual(dockBounds(area, 'left', 0.5, true), { x: -1300, y: 412, width: 22, height: 56 })
  assert.deepEqual(dockBounds(area, 'top', 0.5, true), { x: -728, y: 35, width: 56, height: 22 })
})
