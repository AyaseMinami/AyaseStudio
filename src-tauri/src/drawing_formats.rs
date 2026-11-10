//! Static vector validation and bounded animated-image decoding for drawing outputs.
//! Originals are never rewritten. Raster pixels are derived only for PNG exports/thumbnails.
use std::{
    collections::HashMap,
    io::Cursor,
    sync::{Arc, OnceLock},
};

use image::{AnimationDecoder, DynamicImage, ImageDecoder, Limits};
use resvg::{tiny_skia, usvg};
use roxmltree::{Document, Node};

use super::{Error, PIXEL_LIMIT};

const SVG_LIMIT: usize = 4 * 1024 * 1024;
const SVG_NODES: usize = 20_000;
const SVG_EXPANDED_NODES: usize = 50_000;
const SVG_RASTER_BYTES: u64 = 256 * 1024 * 1024;
const GIF_FRAMES: usize = 64;
const GIF_PIXELS: u64 = 128_000_000;

fn dimensions(width: u32, height: u32) -> Result<(), Error> {
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > PIXEL_LIMIT {
        return Err(Error::TooLarge);
    }
    Ok(())
}

pub(super) fn decode_gif(bytes: &[u8]) -> Result<DynamicImage, Error> {
    // Decode every frame before publication, including malformed later frames.
    let mut decoder =
        image::codecs::gif::GifDecoder::new(Cursor::new(bytes)).map_err(|_| Error::Corrupt)?;
    let (width, height) = decoder.dimensions();
    dimensions(width, height)?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    decoder.set_limits(limits).map_err(|_| Error::TooLarge)?;
    let mut first = None;
    let mut pixels = 0u64;
    for (index, frame) in decoder.into_frames().enumerate() {
        if index >= GIF_FRAMES {
            return Err(Error::TooLarge);
        }
        pixels += u64::from(width) * u64::from(height);
        if pixels > GIF_PIXELS {
            return Err(Error::TooLarge);
        }
        let frame = frame.map_err(|_| Error::Corrupt)?;
        if first.is_none() {
            first = Some(DynamicImage::ImageRgba8(frame.into_buffer()));
        }
    }
    first.ok_or(Error::Corrupt)
}

fn presentation_property(name: &str) -> bool {
    matches!(
        name,
        "fill"
            | "fill-rule"
            | "fill-opacity"
            | "stroke"
            | "stroke-width"
            | "stroke-opacity"
            | "stroke-linecap"
            | "stroke-linejoin"
            | "stroke-miterlimit"
            | "stroke-dasharray"
            | "stroke-dashoffset"
            | "opacity"
            | "color"
            | "display"
            | "visibility"
            | "font-family"
            | "font-size"
            | "font-weight"
            | "font-style"
            | "font-stretch"
            | "font-variant"
            | "letter-spacing"
            | "word-spacing"
            | "text-anchor"
            | "dominant-baseline"
            | "alignment-baseline"
            | "baseline-shift"
            | "text-decoration"
            | "text-rendering"
            | "shape-rendering"
            | "clip-path"
            | "clip-rule"
            | "mask"
            | "stop-color"
            | "stop-opacity"
            | "flood-color"
            | "flood-opacity"
            | "lighting-color"
            | "color-interpolation"
            | "color-interpolation-filters"
            | "paint-order"
            | "vector-effect"
            | "marker-start"
            | "marker-end"
    )
}

fn fragment(value: &str) -> Result<&str, Error> {
    let id = value.strip_prefix('#').ok_or(Error::Corrupt)?;
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':'))
    {
        return Err(Error::Corrupt);
    }
    Ok(id)
}

fn static_value(value: &str) -> Result<(), Error> {
    // No CSS escapes, comments, directives, markup, or external resource URLs.
    if value.contains(['\\', '@', '<', '>'])
        || value.contains("/*")
        || value
            .chars()
            .any(|c| c.is_control() && !c.is_ascii_whitespace())
    {
        return Err(Error::Corrupt);
    }
    resource_references(value)?;
    Ok(())
}

fn resource_references(value: &str) -> Result<Vec<&str>, Error> {
    let lower = value.to_ascii_lowercase();
    let mut offset = 0;
    let mut references = Vec::new();
    let mut remainder = lower.as_str();
    while let Some(start) = remainder.find("url(") {
        offset += start + 4;
        remainder = &remainder[start + 4..];
        let end = remainder.find(')').ok_or(Error::Corrupt)?;
        let reference = value[offset..offset + end].trim().trim_matches(['\'', '"']);
        references.push(fragment(reference)?);
        offset += end + 1;
        remainder = &remainder[end + 1..];
    }
    Ok(references)
}

fn declarations(value: &str) -> Result<(), Error> {
    static_value(value)?;
    for declaration in value
        .split(';')
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let (property, _) = declaration.split_once(':').ok_or(Error::Corrupt)?;
        if !presentation_property(property.trim()) {
            return Err(Error::Corrupt);
        }
    }
    Ok(())
}

fn stylesheet(value: &str) -> Result<(), Error> {
    static_value(value)?;
    // CSS selectors and inherited properties obscure reference multiplicity.
    // Resource URLs must be attached directly to a bounded XML element.
    if !resource_references(value)?.is_empty() {
        return Err(Error::Corrupt);
    }
    let mut remaining = value.trim();
    while !remaining.is_empty() {
        let (selector, rest) = remaining.split_once('{').ok_or(Error::Corrupt)?;
        if selector.trim().is_empty() || selector.contains(['}', ';']) {
            return Err(Error::Corrupt);
        }
        let (body, rest) = rest.split_once('}').ok_or(Error::Corrupt)?;
        if body.contains('{') {
            return Err(Error::Corrupt);
        }
        declarations(body)?;
        remaining = rest.trim();
    }
    Ok(())
}

fn element(name: &str) -> bool {
    matches!(
        name,
        "svg"
            | "g"
            | "defs"
            | "path"
            | "rect"
            | "circle"
            | "ellipse"
            | "line"
            | "polyline"
            | "polygon"
            | "text"
            | "tspan"
            | "textPath"
            | "use"
            | "symbol"
            | "clipPath"
            | "mask"
            | "linearGradient"
            | "radialGradient"
            | "stop"
            | "marker"
            | "title"
            | "desc"
            | "style"
    )
}

fn attribute(name: &str) -> bool {
    presentation_property(name)
        || matches!(
            name,
            "id" | "class"
                | "style"
                | "version"
                | "x"
                | "y"
                | "x1"
                | "y1"
                | "x2"
                | "y2"
                | "width"
                | "height"
                | "viewBox"
                | "preserveAspectRatio"
                | "d"
                | "points"
                | "cx"
                | "cy"
                | "r"
                | "rx"
                | "ry"
                | "dx"
                | "dy"
                | "rotate"
                | "transform"
                | "gradientTransform"
                | "gradientUnits"
                | "spreadMethod"
                | "offset"
                | "fx"
                | "fy"
                | "fr"
                | "clipPathUnits"
                | "maskUnits"
                | "maskContentUnits"
                | "patternUnits"
                | "patternContentUnits"
                | "patternTransform"
                | "markerWidth"
                | "markerHeight"
                | "refX"
                | "refY"
                | "orient"
                | "markerUnits"
                | "textLength"
                | "lengthAdjust"
                | "startOffset"
                | "method"
                | "spacing"
                | "href"
                | "role"
                | "aria-label"
                | "aria-labelledby"
                | "type"
                | "filterUnits"
                | "primitiveUnits"
                | "in"
                | "in2"
                | "result"
                | "stdDeviation"
                | "mode"
                | "values"
                | "operator"
                | "k1"
                | "k2"
                | "k3"
                | "k4"
                | "tableValues"
                | "slope"
                | "intercept"
                | "amplitude"
                | "exponent"
                | "radius"
        )
}

fn expand<'a>(
    node: Node<'a, 'a>,
    ids: &HashMap<&'a str, Node<'a, 'a>>,
    active: &mut Vec<roxmltree::NodeId>,
    budget: &mut usize,
) -> Result<(), Error> {
    if *budget == 0 || active.len() >= 64 || active.contains(&node.id()) {
        return Err(Error::TooLarge);
    }
    // Include repeated geometry/text payloads, not just their enclosing nodes.
    let cost = 1
        + node.attribute("d").unwrap_or("").len() / 8
        + node.attribute("points").unwrap_or("").len() / 8
        + node
            .children()
            .filter(Node::is_text)
            .map(|child| child.text().unwrap_or("").chars().count())
            .sum::<usize>();
    *budget = budget.checked_sub(cost).ok_or(Error::TooLarge)?;
    active.push(node.id());
    if let Some(href) = node
        .attribute("href")
        .or_else(|| node.attribute(("http://www.w3.org/1999/xlink", "href")))
    {
        let target = ids.get(fragment(href)?).ok_or(Error::Corrupt)?;
        expand(*target, ids, active, budget)?;
    }
    // Start/end markers repeat for each path subpath. Count both absolute and
    // relative moveto commands before the renderer builds any repeated trees.
    let multiplicity = if node.tag_name().name() == "path" {
        node.attribute("d")
            .unwrap_or("")
            .bytes()
            .filter(|b| matches!(b, b'M' | b'm'))
            .count()
            .max(1)
    } else {
        1
    };
    for attr in node.attributes() {
        for id in resource_references(attr.value())? {
            let target = ids.get(id).ok_or(Error::Corrupt)?;
            for _ in 0..multiplicity {
                expand(*target, ids, active, budget)?;
            }
        }
    }
    for child in node.children().filter(Node::is_element) {
        expand(child, ids, active, budget)?;
    }
    active.pop();
    Ok(())
}

fn resource_owner(node: Node<'_, '_>, property: &str, value: &str) -> Result<(), Error> {
    // These properties are inherited and can multiply a resource once per
    // descendant. Keep them on direct shapes so the expansion budget is exact
    // or conservative. marker-mid is excluded because it repeats per segment.
    if matches!(property, "fill" | "stroke" | "marker-start" | "marker-end")
        && !resource_references(value)?.is_empty()
        && !matches!(
            node.tag_name().name(),
            "path" | "line" | "polyline" | "polygon" | "rect" | "circle" | "ellipse"
        )
    {
        return Err(Error::Corrupt);
    }
    Ok(())
}

fn validate_svg(text: &str) -> Result<(), Error> {
    // roxmltree rejects DTD/entities by default. No processing instructions are accepted.
    let doc = Document::parse(text).map_err(|_| Error::Corrupt)?;
    let root = doc.root_element();
    if root.tag_name().name() != "svg"
        || root.tag_name().namespace() != Some("http://www.w3.org/2000/svg")
    {
        return Err(Error::Corrupt);
    }
    let mut ids = HashMap::new();
    let mut count = 0;
    for node in doc.descendants() {
        if node.is_pi() {
            return Err(Error::Corrupt);
        }
        if !node.is_element() {
            continue;
        }
        count += 1;
        if count > SVG_NODES || node.ancestors().take(66).count() > 65 {
            return Err(Error::TooLarge);
        }
        if node.tag_name().namespace() != Some("http://www.w3.org/2000/svg")
            || !element(node.tag_name().name())
        {
            return Err(Error::Corrupt);
        }
        if let Some(id) = node.attribute("id") {
            if ids.insert(id, node).is_some() {
                return Err(Error::Corrupt);
            }
        }
        if node.has_attribute("href")
            && node.has_attribute(("http://www.w3.org/1999/xlink", "href"))
        {
            // Browser and usvg precedence differs. A dual reference is ambiguous.
            return Err(Error::Corrupt);
        }
        for attr in node.attributes() {
            if attr.namespace() == Some("http://www.w3.org/XML/1998/namespace")
                && matches!(attr.name(), "space" | "lang")
            {
                continue;
            }
            if attr
                .namespace()
                .is_some_and(|ns| ns != "http://www.w3.org/1999/xlink")
                || !attribute(attr.name())
            {
                return Err(Error::Corrupt);
            }
            if attr.name() == "href" {
                fragment(attr.value())?;
            } else if attr.name() == "style" {
                declarations(attr.value())?;
                for declaration in attr
                    .value()
                    .split(';')
                    .filter(|value| !value.trim().is_empty())
                {
                    let (property, value) = declaration.split_once(':').ok_or(Error::Corrupt)?;
                    resource_owner(node, property.trim(), value)?;
                }
            } else {
                static_value(attr.value())?;
                resource_owner(node, attr.name(), attr.value())?;
            }
        }
        if node.tag_name().name() == "style" {
            let css: String = node.children().filter_map(|child| child.text()).collect();
            stylesheet(&css)?;
        }
    }
    let mut budget = SVG_EXPANDED_NODES;
    expand(root, &ids, &mut Vec::new(), &mut budget)
}

struct RasterBudget {
    remaining: u64,
    max_width: f64,
    max_height: f64,
}

fn validate_raster_budget(tree: &usvg::Tree) -> Result<(), Error> {
    let size = tree.size().to_int_size();
    dimensions(size.width(), size.height())?;
    let pixels = u64::from(size.width()) * u64::from(size.height());
    let mut budget = RasterBudget {
        remaining: SVG_RASTER_BYTES,
        max_width: f64::from(size.width()) * 5.0,
        max_height: f64::from(size.height()) * 5.0,
    };
    budget.charge(pixels, 8)?;
    budget.group(tree.root(), pixels, tiny_skia::Transform::identity(), 0)
}

impl RasterBudget {
    fn charge(&mut self, pixels: u64, bytes_per_pixel: u64) -> Result<(), Error> {
        let bytes = pixels.checked_mul(bytes_per_pixel).ok_or(Error::TooLarge)?;
        self.remaining = self.remaining.checked_sub(bytes).ok_or(Error::TooLarge)?;
        Ok(())
    }

    fn group(
        &mut self,
        group: &usvg::Group,
        parent_pixels: u64,
        parent_transform: tiny_skia::Transform,
        depth: usize,
    ) -> Result<(), Error> {
        if depth > 64 {
            return Err(Error::TooLarge);
        }
        let transform = parent_transform.pre_concat(group.transform());
        let pixels = if group.should_isolate() {
            // Resource roots use their owner's runtime coordinate system.
            // The stored absolute bbox omits this scale for reusable masks.
            let bounds = group
                .layer_bounding_box()
                .transform(transform)
                .ok_or(Error::TooLarge)?;
            let width = f64::from(bounds.width()).ceil() + 4.0;
            let height = f64::from(bounds.height()).ceil() + 4.0;
            if !width.is_finite() || !height.is_finite() {
                return Err(Error::TooLarge);
            }
            // Resvg caps layers at 5x the original canvas per axis. Ignore their
            // position so nested render translations cannot invalidate this bound.
            let pixels = (width.min(self.max_width) * height.min(self.max_height)) as u64;
            self.charge(pixels, 4)?;
            pixels
        } else {
            parent_pixels
        };
        if !group.filters().is_empty() {
            return Err(Error::Corrupt);
        }
        if let Some(clip) = group.clip_path() {
            self.clip(clip, pixels, depth + 1)?;
        }
        if let Some(mask) = group.mask() {
            self.mask(mask, pixels, transform, depth + 1)?;
        }
        for node in group.children() {
            match node {
                usvg::Node::Group(child) => self.group(child, pixels, transform, depth + 1)?,
                usvg::Node::Text(text) => {
                    self.group(text.flattened(), pixels, transform, depth + 1)?
                }
                usvg::Node::Image(_) => return Err(Error::Corrupt),
                usvg::Node::Path(_) => {}
            }
        }
        Ok(())
    }

    fn clip(&mut self, clip: &usvg::ClipPath, pixels: u64, depth: usize) -> Result<(), Error> {
        if depth > 64 {
            return Err(Error::TooLarge);
        }
        self.charge(pixels, 5)?; // RGBA clip image and alpha mask.
        self.clip_children(clip.root(), pixels, depth + 1)?;
        if let Some(next) = clip.clip_path() {
            self.clip(next, pixels, depth + 1)?;
        }
        Ok(())
    }

    fn clip_children(
        &mut self,
        group: &usvg::Group,
        pixels: u64,
        depth: usize,
    ) -> Result<(), Error> {
        if depth > 64 {
            return Err(Error::TooLarge);
        }
        for node in group.children() {
            match node {
                usvg::Node::Group(child) => {
                    if let Some(clip) = child.clip_path() {
                        self.charge(pixels, 4)?;
                        self.clip(clip, pixels, depth + 1)?;
                    }
                    self.clip_children(child, pixels, depth + 1)?;
                }
                usvg::Node::Text(text) => {
                    self.clip_children(text.flattened(), pixels, depth + 1)?
                }
                usvg::Node::Image(_) => return Err(Error::Corrupt),
                usvg::Node::Path(_) => {}
            }
        }
        Ok(())
    }

    fn mask(
        &mut self,
        mask: &usvg::Mask,
        pixels: u64,
        transform: tiny_skia::Transform,
        depth: usize,
    ) -> Result<(), Error> {
        if depth > 64 {
            return Err(Error::TooLarge);
        }
        self.charge(pixels, 6)?; // RGBA, clipping alpha and the final alpha mask.
        self.group(mask.root(), pixels, transform, depth + 1)?;
        if let Some(next) = mask.mask() {
            self.mask(next, pixels, transform, depth + 1)?;
        }
        Ok(())
    }
}

pub(super) fn decode_svg(bytes: &[u8]) -> Result<DynamicImage, Error> {
    if bytes.len() > SVG_LIMIT {
        return Err(Error::TooLarge);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| Error::Corrupt)?;
    validate_svg(text)?;
    static FONTS: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    let fonts = FONTS.get_or_init(|| {
        let mut fonts = usvg::fontdb::Database::new();
        fonts.load_system_fonts();
        Arc::new(fonts)
    });
    let options = usvg::Options {
        fontdb: fonts.clone(),
        // Defense in depth: even validated SVG never has a file/data image resolver.
        image_href_resolver: usvg::ImageHrefResolver {
            resolve_data: Box::new(|_, _, _| None),
            resolve_string: Box::new(|_, _| None),
        },
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_str(text, &options).map_err(|_| Error::Corrupt)?;
    let size = tree.size().to_int_size();
    dimensions(size.width(), size.height())?;
    validate_raster_budget(&tree)?;
    let mut pixmap = tiny_skia::Pixmap::new(size.width(), size.height()).ok_or(Error::TooLarge)?;
    resvg::render(
        &tree,
        tiny_skia::Transform::identity(),
        &mut pixmap.as_mut(),
    );
    // tiny-skia stores premultiplied alpha; PNG/image pixels use straight alpha.
    let rgba: Vec<u8> = pixmap
        .pixels()
        .iter()
        .flat_map(|pixel| {
            let color = pixel.demultiply();
            [color.red(), color.green(), color.blue(), color.alpha()]
        })
        .collect();
    let image =
        image::RgbaImage::from_raw(size.width(), size.height(), rgba).ok_or(Error::Corrupt)?;
    Ok(DynamicImage::ImageRgba8(image))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn animated_gif() -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut bytes);
            encoder
                .set_repeat(image::codecs::gif::Repeat::Infinite)
                .unwrap();
            for color in [[255, 0, 0, 255], [0, 0, 255, 255]] {
                let frame = image::Frame::from_parts(
                    image::RgbaImage::from_pixel(20, 10, image::Rgba(color)),
                    0,
                    0,
                    image::Delay::from_numer_denom_ms(200, 1),
                );
                encoder.encode_frame(frame).unwrap();
            }
        }
        bytes
    }

    #[test]
    fn preserves_vectors_and_animated_bytes_through_save_recovery_read_and_export() {
        use super::super::*;
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/></svg>"#.to_vec();
        for (mime, bytes, ext) in [
            ("image/svg+xml", svg, "svg"),
            ("image/gif", animated_gif(), "gif"),
        ] {
            let root = tempfile::tempdir().unwrap();
            let external = tempfile::tempdir().unwrap();
            let task = Uuid::new_v4().to_string();
            let input = DrawingImageInput {
                mime: mime.into(),
                data: STANDARD.encode(&bytes),
            };
            let files = save(root.path(), &task, &[input]).unwrap();
            let file = &files[0];
            assert!(file.reference.ends_with(ext));
            assert_eq!((file.width, file.height), (20, 10));
            assert_eq!(recover(root.path(), &task).unwrap(), Some(files.clone()));
            let readback = read(root.path(), &file.reference).unwrap();
            assert_eq!(readback.mime, mime);
            assert_eq!(STANDARD.decode(readback.data).unwrap(), bytes);
            assert_eq!(
                thumbnail(root.path(), &file.reference).unwrap().mime,
                "image/png"
            );
            let original = external.path().join(format!("original.{ext}"));
            export_original(root.path(), &file.reference, &original).unwrap();
            assert_eq!(std::fs::read(&original).unwrap(), bytes);
            let png = external.path().join("converted.png");
            export_png(root.path(), &file.reference, &png).unwrap();
            let pixels = image::open(&png).unwrap().to_rgba8();
            assert_eq!(pixels.get_pixel(0, 0).0, [255, 0, 0, 255]);
            assert!(
                export_original(
                    root.path(),
                    &file.reference,
                    &result_path(root.path(), &file.reference).unwrap()
                )
                .is_err()
            );
            discard_completed(root.path(), &task).unwrap();
            assert!(read(root.path(), &file.reference).is_err());
        }
    }

    #[test]
    fn malformed_outputs_do_not_create_durable_files() {
        use super::super::*;
        for (mime, data) in [
            ("image/svg+xml", b"<svg onload='alert(1)'/>".as_slice()),
            ("image/gif", b"GIF89a".as_slice()),
        ] {
            let root = tempfile::tempdir().unwrap();
            let task = Uuid::new_v4().to_string();
            assert!(
                save(
                    root.path(),
                    &task,
                    &[DrawingImageInput {
                        mime: mime.into(),
                        data: STANDARD.encode(data)
                    }]
                )
                .is_err()
            );
            assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
        }
    }

    #[test]
    fn bounds_animation_frames_and_checks_later_frame_data() {
        let valid = animated_gif();
        assert!(decode_gif(&valid).is_ok());
        assert!(decode_gif(&valid[..valid.len() / 2]).is_err());
        let mut bytes = Vec::new();
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut bytes);
            for _ in 0..65 {
                encoder
                    .encode_frame(image::Frame::new(image::RgbaImage::new(2, 2)))
                    .unwrap();
            }
        }
        assert!(matches!(decode_gif(&bytes), Err(Error::TooLarge)));
    }

    #[test]
    fn export_parameters_accept_only_format_matching_openai_fields() {
        use super::super::DrawingExportParameters;
        for valid in [
            serde_json::json!({"protocol":"openai-images","prompt":"x","model":"test","output_format":"svg","svg_model":"author"}),
            serde_json::json!({"protocol":"openai-images","prompt":"x","model":"test","output_format":"gif","frame_count":2,"frame_duration_ms":20}),
        ] {
            let parameters: DrawingExportParameters = serde_json::from_value(valid).unwrap();
            assert!(parameters.validate().is_ok());
        }
        for (format, field, value) in [
            ("png", "svg_model", serde_json::json!("author")),
            ("svg", "frame_count", serde_json::json!(2)),
            ("gif", "svg_model", serde_json::json!("author")),
            ("gif", "frame_count", serde_json::json!(17)),
            ("gif", "frame_duration_ms", serde_json::json!(19)),
        ] {
            let mut parameters = serde_json::json!({"protocol":"openai-images","prompt":"x","model":"test","output_format":format});
            parameters[field] = value;
            let parameters: DrawingExportParameters = serde_json::from_value(parameters).unwrap();
            assert!(parameters.validate().is_err());
        }
    }

    #[test]
    fn rejects_active_external_and_entity_content_before_rendering() {
        for content in [
            "<script>alert(1)</script>",
            "<rect onload='alert(1)'/>",
            "<foreignObject/>",
            "<image href='https://example.test/private'/>",
            "<use href='file:///private'/>",
            "<style>@import 'https://example.test/a';</style>",
            "<rect fill='url(https://example.test/a)'/>",
            "<style>.a{fill:u\\72l(https://example.test)}</style>",
            "<style>.a{fill:u/**/rl(https://example.test)}</style>",
            "<animate attributeName='href'/>",
            "<style>.a{cursor:url(https://example.test/a)}</style>",
            "<?xml-stylesheet href='file:///a'?>",
        ] {
            let svg = format!(
                "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'>{content}</svg>"
            );
            assert_eq!(validate_svg(&svg), Err(Error::Corrupt), "{content}");
        }
        assert!(validate_svg("<!DOCTYPE svg [<!ENTITY x SYSTEM 'file:///a'>]><svg xmlns='http://www.w3.org/2000/svg'>&x;</svg>").is_err());
    }

    #[test]
    fn rejects_cycles_and_expansion_bombs() {
        let cyclic = "<svg xmlns='http://www.w3.org/2000/svg'><g id='a'><use href='#a'/></g></svg>";
        assert_eq!(validate_svg(cyclic), Err(Error::TooLarge));
        let mut defs = "<g id='a0'><path d='M0 0'/></g>".to_owned();
        for i in 1..18 {
            defs.push_str(&format!(
                "<g id='a{i}'><use href='#a{}'/><use href='#a{}'/></g>",
                i - 1,
                i - 1
            ));
        }
        assert_eq!(
            validate_svg(&format!(
                "<svg xmlns='http://www.w3.org/2000/svg'><defs>{defs}</defs><use href='#a17'/></svg>"
            )),
            Err(Error::TooLarge)
        );
        let mut markers = "<marker id='m0'><path d='M0 0L1 1'/></marker>".to_owned();
        for i in 1..18 {
            markers.push_str(&format!("<marker id='m{i}'><line x2='1' y2='1' marker-start='url(#m{})' marker-end='url(#m{})'/></marker>", i-1, i-1));
        }
        assert_eq!(
            validate_svg(&format!(
                "<svg xmlns='http://www.w3.org/2000/svg'><defs>{markers}</defs><line x2='10' marker-end='url(#m17)'/></svg>"
            )),
            Err(Error::TooLarge)
        );
        for body in [
            "<g marker-end='url(#m)'><line x2='1'/></g>",
            "<path d='M0 0L1 1' marker-mid='url(#m)'/>",
            "<style>line{marker-end:url(#m)}</style><line x2='1'/>",
        ] {
            let svg = format!(
                "<svg xmlns='http://www.w3.org/2000/svg'><defs><marker id='m'><path d='M0 0L1 1'/></marker></defs>{body}</svg>"
            );
            assert_eq!(validate_svg(&svg), Err(Error::Corrupt));
        }
        let subpaths = "M0 0L1 1".repeat(26_000);
        let svg = format!(
            "<svg xmlns='http://www.w3.org/2000/svg'><defs><marker id='m'><line x2='1'/></marker></defs><path d='{subpaths}' marker-end='url(#m)'/></svg>"
        );
        assert_eq!(validate_svg(&svg), Err(Error::TooLarge));
        let dual = "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'><defs><path id='safe' d='M0 0'/></defs><use href='#safe' xlink:href='#safe'/></svg>";
        assert_eq!(validate_svg(dual), Err(Error::Corrupt));
        let text = "x".repeat(50_000);
        assert_eq!(
            validate_svg(&format!(
                "<svg xmlns='http://www.w3.org/2000/svg'><text>{text}</text></svg>"
            )),
            Err(Error::TooLarge)
        );
    }

    #[test]
    fn rejects_unbounded_surfaces_before_any_raster_allocation() {
        for source in [
            "<pattern id='p' width='100000' height='100000'><rect width='1' height='1'/></pattern>",
            "<filter id='f' width='100000' height='100000'><feFlood/></filter>",
        ] {
            assert_eq!(
                validate_svg(&format!(
                    "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><defs>{source}</defs></svg>"
                )),
                Err(Error::Corrupt)
            );
        }
        let mut source =
            "<svg xmlns='http://www.w3.org/2000/svg' width='8000' height='4000'>".to_owned();
        source.push_str(&"<g opacity='.5'>".repeat(60));
        source.push_str("<rect width='8000' height='4000'/>");
        source.push_str(&"</g>".repeat(60));
        source.push_str("</svg>");
        validate_svg(&source).unwrap();
        let tree = usvg::Tree::from_str(&source, &usvg::Options::default()).unwrap();
        assert_eq!(validate_raster_budget(&tree), Err(Error::TooLarge));
        let layers = format!(
            "{}<rect width='1' height='1' fill='white'/>{}",
            "<g opacity='.5'>".repeat(50),
            "</g>".repeat(50)
        );
        let source = format!(
            "<svg xmlns='http://www.w3.org/2000/svg' width='1000' height='1000'><defs><mask id='scaled' maskUnits='userSpaceOnUse' x='0' y='0' width='1' height='1'>{layers}</mask></defs><g transform='scale(2000)' mask='url(#scaled)'><rect width='1' height='1'/></g></svg>"
        );
        validate_svg(&source).unwrap();
        let tree = usvg::Tree::from_str(&source, &usvg::Options::default()).unwrap();
        assert_eq!(validate_raster_budget(&tree), Err(Error::TooLarge));
    }

    #[test]
    fn supports_bounded_arrows_gradients_clips_and_masks() {
        let source = br##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><defs><marker id="arrow" markerWidth="3" markerHeight="3" refX="1" refY="1"><path d="M0 0L2 1L0 2z"/></marker><clipPath id="c"><rect width="90" height="90"/></clipPath><mask id="m"><rect width="100" height="100" fill="white"/></mask></defs><g opacity="0.8" clip-path="url(#c)" mask="url(#m)"><path d="M10 10L80 80" stroke="red" marker-end="url(#arrow)"/></g></svg>"##;
        let image = decode_svg(source).unwrap();
        assert_eq!((image.width(), image.height()), (100, 100));
    }

    #[test]
    fn renders_static_vectors_css_and_alpha() {
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><style>.a{fill:#ff0000;fill-opacity:0.5}</style><defs><linearGradient id="g"><stop stop-color="blue"/></linearGradient></defs><rect class="a" width="10" height="10"/><rect x="10" width="10" height="10" fill="url(#g)"/></svg>"##;
        let image = decode_svg(svg).unwrap().to_rgba8();
        assert_eq!(image.dimensions(), (20, 10));
        assert_eq!(image.get_pixel(0, 0).0, [255, 0, 0, 128]);
        assert_eq!(image.get_pixel(15, 0).0, [0, 0, 255, 255]);
    }
}
