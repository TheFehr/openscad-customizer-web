/* [Badge] */

// Overall diameter in mm
diameter = 40; // [20:100]

// Badge thickness in mm
thickness = 5; // [2:0.5:12]

// Rim width around the inset
border_width = 3; // [1:0.5:8]

/* [Inset] */

// How deep the inset sits below the rim
inset_depth = 1.5; // [0.5:0.1:4]

// Shape of the color inset
inset_shape = "circle"; // [circle:Circle,star:Star,hex:Hexagon]

/* [Colors] */

// Base plate color (hex — also used for the .3mf/preview color, not just geometry preview)
base_color = "#2b2b2b";

// Inset color
inset_color = "#c9a227";

/* [Hidden] */

$fn = 64;

function inset_radius() = (diameter - border_width * 2 - 4) / 2;

module inset_2d() {
    r = inset_radius();
    if (inset_shape == "circle") {
        circle(r = r);
    } else if (inset_shape == "hex") {
        polygon(points = [for (a = [0:60:300]) [r * cos(a), r * sin(a)]]);
    } else {
        r_in = r * 0.45;
        polygon(points = [for (i = [0:9]) let (a = 90 + i * 36, rr = (i % 2 == 0) ? r : r_in) [rr * cos(a), rr * sin(a)]]);
    }
}

// The outer plate, with a pocket cut for the inset to sit in. This is the
// module rendered in the "base" color pass — see worker.js.
module badge_base() {
    difference() {
        cylinder(d = diameter, h = thickness);
        translate([0, 0, thickness - inset_depth])
            linear_extrude(inset_depth + 0.1)
                inset_2d();
    }
}

// The plug that fills the pocket, in the "inset" color pass.
module badge_inset() {
    translate([0, 0, thickness - inset_depth])
        linear_extrude(inset_depth)
            inset_2d();
}

badge_base();
