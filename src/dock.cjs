const edges = ['left', 'right', 'top', 'bottom']
const expandedSize = { width: 352, height: 420 }
const capsuleSize = { width: 22, height: 56 }
const isVertical = (edge) => edge === 'left' || edge === 'right'
const clamp = (value, min, max) => Math.max(min, Math.min(value, max))
const panelMargin = 12

function dockBounds(area, edge, anchor, collapsed) {
  const vertical = isVertical(edge)
  const margin = collapsed ? 0 : panelMargin
  const size = collapsed
    ? vertical ? capsuleSize : { width: capsuleSize.height, height: capsuleSize.width }
    : expandedSize
  const width = Math.min(size.width, Math.max(1, area.width - margin * 2))
  const height = Math.min(size.height, Math.max(1, area.height - margin * 2))
  const xTravel = Math.max(0, area.width - width - 2 * margin)
  const yTravel = Math.max(0, area.height - height - 2 * margin)
  const x = area.x + margin + Math.round(xTravel * (vertical ? Number(edge === 'right') : anchor))
  const y = area.y + margin + Math.round(yTravel * (vertical ? anchor : Number(edge === 'bottom')))
  return { x, y, width, height }
}

function nearestDock(area, pointer, bounds) {
  const distances = {
    left: Math.abs(pointer.x - area.x),
    right: Math.abs(area.x + area.width - pointer.x),
    top: Math.abs(pointer.y - area.y),
    bottom: Math.abs(area.y + area.height - pointer.y),
  }
  const edge = edges.reduce((best, item) => distances[item] < distances[best] ? item : best)
  const vertical = isVertical(edge)
  const start = vertical ? area.y : area.x
  const length = vertical ? area.height : area.width
  const size = vertical ? bounds.height : bounds.width
  const center = vertical ? bounds.y + size / 2 : bounds.x + size / 2
  const span = Math.max(1, length - size - panelMargin * 2)
  return { edge, anchor: clamp((center - start - panelMargin - size / 2) / span, 0, 1) }
}

module.exports = { edges, expandedSize, dockBounds, nearestDock }
