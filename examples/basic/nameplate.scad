/* [Plate] */

// Plate width in mm
width = 80; // [40:200]

// Plate height in mm
height = 30; // [20:100]

// Plate thickness in mm
thickness = 4; // [2:0.5:10]

// Corner rounding radius
corner_radius = 3; // [0:0.5:15]

/* [Text] */

// Text to emboss on the plate
label = "Hello!";

// Text depth cut into the plate surface
text_depth = 1.2; // [0.2:0.1:3]

// Font size
text_size = 10; // [4:1:24]

/* [Mounting] */

// Add mounting holes
mounting_holes = true;

// Number of mounting holes
hole_count = 2; // [2,4]

// Hole style
hole_style = "round"; // [round:Round,slot:Slotted]

/* [Appearance] */

// Preview color (color() is preview/slicer-only, doesn't affect geometry)
plate_color = "SlateGray";

// Corner style
corner_style = "rounded"; // [rounded:Rounded,chamfered:Chamfered,square:Square]

/* [Hidden] */

$fn = 48;

module rounded_box(w, h, t, r) {
    if (r <= 0) {
        cube([w, h, t]);
    } else {
        hull() {
            for (x = [r, w - r])
                for (y = [r, h - r])
                    translate([x, y, 0])
                        cylinder(r = r, h = t);
        }
    }
}

module mounting_hole_positions(w, h, count) {
    margin = 6;
    if (count == 2) {
        for (x = [margin, w - margin])
            translate([x, h / 2, 0]) children();
    } else {
        for (x = [margin, w - margin])
            for (y = [margin, h - margin])
                translate([x, y, 0]) children();
    }
}

module nameplate() {
    color(plate_color)
    difference() {
        rounded_box(width, height, thickness, corner_style == "square" ? 0 : corner_radius);

        if (mounting_holes) {
            mounting_hole_positions(width, height, hole_count)
                cylinder(r = hole_style == "slot" ? 2 : 2.5, h = thickness * 3, center = true);
        }

        translate([width / 2, height / 2, thickness - text_depth])
            linear_extrude(text_depth + 0.5)
                text(label, size = text_size, halign = "center", valign = "center");
    }
}

nameplate();
