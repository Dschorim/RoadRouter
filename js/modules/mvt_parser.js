// mvt_parser.js - Mapbox Vector Tile (MVT) / PBF parsing helpers

export function parseMVTTile(arrayBuffer) {
    const view = new Uint8Array(arrayBuffer);
    const features = [];

    try {
        let pos = 0;

        while (pos < view.length) {
            const byte = view[pos];
            const fieldNum = byte >> 3;
            const wireType = byte & 0x07;
            pos++;

            if (fieldNum === 3 && wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize;

                const layerEnd = pos + len;
                const layer = decodePBFLayer(view, pos, layerEnd);

                if (layer.name === 'speeds' && layer.features) {
                    layer.features.forEach((feature, fIdx) => {
                        const props = {};

                        if (feature.tags && layer.keys && layer.values) {
                            for (let i = 0; i < feature.tags.length; i += 2) {
                                const keyIdx = feature.tags[i];
                                const valIdx = feature.tags[i + 1];

                                if (layer.keys[keyIdx] !== undefined && layer.values[valIdx] !== undefined) {
                                    const key = layer.keys[keyIdx];
                                    const val = layer.values[valIdx];
                                    props[key] = val;
                                }
                            }
                        }

                        let speedValue = 0;
                        if (props.speed !== undefined) {
                            speedValue = typeof props.speed === 'number' ? Math.round(props.speed) : parseInt(props.speed) || 0;
                        }

                        features.push({
                            speed: speedValue,
                            geometry: decodeGeometry(feature.geometry || []),
                            properties: props
                        });
                    });
                }

                pos = layerEnd;
            } else if (wireType === 0) {
                pos = skipVarInt(view, pos);
            } else if (wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize + len;
            } else {
                pos++;
            }
        }
    } catch (e) {
        console.error('MVT parse error:', e);
    }

    return features;
}

function decodePBFLayer(view, start, end) {
    const layer = {
        name: '',
        keys: [],
        values: [],
        features: []
    };

    let pos = start;

    try {
        while (pos < end) {
            const byte = view[pos];
            const fieldNum = byte >> 3;
            const wireType = byte & 0x07;
            pos++;

            if (fieldNum === 1 && wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize;
                layer.name = new TextDecoder().decode(view.slice(pos, pos + len));
                pos += len;
            } else if (fieldNum === 2 && wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize;

                const featureEnd = pos + len;
                const feature = decodePBFFeature(view, pos, featureEnd);
                layer.features.push(feature);
                pos = featureEnd;
            } else if (fieldNum === 3 && wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize;
                const key = new TextDecoder().decode(view.slice(pos, pos + len));
                layer.keys.push(key);
                pos += len;
            } else if (fieldNum === 4 && wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize;
                const valStart = pos;
                pos += len;

                const value = decodeTileValue(view.slice(valStart, pos));
                layer.values.push(value);
            } else if (wireType === 0) {
                pos = skipVarInt(view, pos);
            } else if (wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize + len;
            } else {
                pos++;
            }
        }
    } catch (e) {
        console.error('Layer decode error:', e);
    }

    return layer;
}

function decodeTileValue(view) {
    if (view.length === 0) return '';

    let pos = 0;
    const byte = view[pos];
    const fieldNum = byte >> 3;
    const wireType = byte & 0x07;
    pos++;

    try {
        if (wireType === 0) {
            const [val] = readVarIntInfo(view, pos);
            return val;
        } else if (wireType === 1) {
            const dv = new DataView(view.buffer, view.byteOffset + pos, 8);
            return dv.getFloat64(0, true);
        } else if (wireType === 2) {
            const [len, lenSize] = readVarIntInfo(view, pos);
            pos += lenSize;
            try {
                return new TextDecoder().decode(view.slice(pos, pos + len));
            } catch (e) {
                return '';
            }
        } else if (wireType === 5) {
            const dv = new DataView(view.buffer, view.byteOffset + pos, 4);
            return dv.getFloat32(0, true);
        }
    } catch (e) {
        console.error('Value decode error:', e);
    }

    return '';
}

function decodePBFFeature(view, start, end) {
    const feature = {
        id: 0,
        tags: [],
        geometry: [],
        type: 1
    };

    let pos = start;

    try {
        while (pos < end) {
            const byte = view[pos];
            const fieldNum = byte >> 3;
            const wireType = byte & 0x07;
            pos++;

            if (fieldNum === 1 && wireType === 0) {
                const [val, size] = readVarIntInfo(view, pos);
                feature.id = val;
                pos += size;
            } else if (fieldNum === 2 && wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize;

                const tagEnd = pos + len;
                while (pos < tagEnd) {
                    const [val, size] = readVarIntInfo(view, pos);
                    feature.tags.push(val);
                    pos += size;
                }
            } else if (fieldNum === 3 && wireType === 0) {
                const [val, size] = readVarIntInfo(view, pos);
                feature.type = val;
                pos += size;
            } else if (fieldNum === 4 && wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize;

                const geoEnd = pos + len;
                while (pos < geoEnd) {
                    const [val, size] = readVarIntInfo(view, pos);
                    feature.geometry.push(val);
                    pos += size;
                }
            } else if (wireType === 0) {
                pos = skipVarInt(view, pos);
            } else if (wireType === 2) {
                const [len, lenSize] = readVarIntInfo(view, pos);
                pos += lenSize + len;
            } else {
                pos++;
            }
        }
    } catch (e) {
        console.error('Feature decode error:', e);
    }

    return feature;
}

function decodeGeometry(geometry) {
    const rings = [];
    let x = 0, y = 0;
    let ring = [];
    let i = 0;

    while (i < geometry.length) {
        const cmd = geometry[i] & 0x07;
        const count = geometry[i] >> 3;
        i++;

        if (cmd === 1) {
            for (let j = 0; j < count && i < geometry.length; j++) {
                const dx = zigzagDecode(geometry[i++]);
                const dy = i < geometry.length ? zigzagDecode(geometry[i++]) : 0;
                x += dx;
                y += dy;
                ring.push({ x, y });
            }
        } else if (cmd === 2) {
            for (let j = 0; j < count && i < geometry.length; j++) {
                const dx = zigzagDecode(geometry[i++]);
                const dy = i < geometry.length ? zigzagDecode(geometry[i++]) : 0;
                x += dx;
                y += dy;
                ring.push({ x, y });
            }
        } else if (cmd === 7) {
            if (ring.length > 0) {
                rings.push(ring);
                ring = [];
            }
        }
    }

    if (ring.length > 0) {
        rings.push(ring);
    }

    return rings;
}

function readVarIntInfo(view, pos) {
    let value = 0;
    let shift = 0;
    let size = 0;
    while (pos < view.length && view[pos] >= 0x80) {
        value |= (view[pos] & 0x7f) << shift;
        shift += 7;
        pos++;
        size++;
    }
    if (pos < view.length) {
        value |= view[pos] << shift;
        size++;
    }
    return [value, size];
}

function skipVarInt(view, pos) {
    while (pos < view.length && view[pos] >= 0x80) pos++;
    return pos + 1;
}

function zigzagDecode(n) {
    return (n >> 1) ^ -(n & 1);
}
