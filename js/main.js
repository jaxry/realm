(function() {
'use strict';

var gl, canvas, program, params, constants, camera, time;

init();

function init() {

    constants = {
        sensitivity: {
            julia: 1 / 4000,
            rotate: 1 / 600,
            translate: 0.6
        },
        aspectRatio: null,
        pixelSize: null,
    };

    params = {
        resolutionScale: 1,
        iterations: 33,
        juliaX: 0.75,
        juliaY: 0.25,
        juliaZ: 0.5,
        rotationRate: 1,
        altColor: 0,
        altColorIntensity: 9,
        sphereShrink: 1,
        actualSensitivity: constants.sensitivity.rotate
    };
    
    canvas =  document.getElementById('canvas');
    gl = canvas.getContext('webgl', {
        alpha: false,
        depth: false,
        stencil: false
    });

   if (!gl) {
        alert('Your browser does not support WebGL.');
    }

    window.onresize = function() {
        canvas.width = window.innerWidth * params.resolutionScale;
        canvas.height = window.innerHeight * params.resolutionScale;

        constants.aspectRatio = canvas.width / canvas.height;
        constants.pixelSize = [1 / canvas.width, 1 / canvas.height];

        gl.viewport(0, 0, canvas.width, canvas.height);
    };
    window.onresize();

    time = new TimeObject();
    camera = CameraHandler();
    InputHandler();
    program = GLHandler();
    initGui();

    animate();
}

function InputHandler() {

    var keysDown = {},
        movement = (function() {
            var t = camera.translate,
                z = camera.zoom;
            return {
                82: function(s){z(1-s);}, // r
                70: function(s){z(1+s);}, // f
                87: function(s){t(s, 0, 0);}, // w
                83: function(s){t(-s, 0, 0);}, // s
                68: function(s){t(0, s, 0);}, // d
                65: function(s){t(0, -s, 0);}, // a
                69: function(s){t(0, 0, s);}, // e
                81: function(s){t(0, 0, -s);} // q
            };
        })();
    canvas.requestPointerLock = canvas.requestPointerLock || canvas.mozRequestPointerLock || canvas.webkitRequestPointerLock;

    function checkPointerLock() {
        return document.pointerLockElement === canvas ||
               document.mozPointerLockElement === canvas ||
               document.webkitPointerLockElement === canvas;
    }

    function scrollHandler(wheel) {
        params.iterations = Math.max(Math.min(params.iterations + wheel, 64), 1);
        program.updateUniforms();
    }

    canvas.addEventListener('mousedown', function(e) {
        canvas.requestPointerLock();
        keysDown.mouse = true;
    });

    canvas.addEventListener('mouseup', function(e) {
        keysDown.mouse = false;
    });

    canvas.addEventListener('mousemove', function(e) {
        var dx = e.movementX || e.mozMovementX || e.webkitMovementX || 0,
            dy = e.movementY || e.mozMovementY || e.webkitMovementY || 0;

        // lazy hack which stops the large mouse jump which occurs when pointer lock is first achieved
        // if (Math.abs(dx) > 60 || Math.abs(dy > 60)) return;
        
        if (keysDown.mouse) {
            params.juliaX = mod(params.juliaX + dx * constants.sensitivity.julia, 1);
            params.juliaY = mod(params.juliaY - dy * constants.sensitivity.julia, 1);
        }
        else if (checkPointerLock()) {
            camera.rotate(dx * params.actualSensitivity, dy * params.actualSensitivity);
        }
    });

    window.addEventListener('keydown', function(e) {
        var key = e.which;

        if (!keysDown[key]) {

            if (movement[key]) {

                var anim = function() {
                    movement[key](constants.sensitivity.translate * time.elapsedAnim);
                    keysDown[key] = window.requestAnimationFrame(anim);
                };
                anim();
            }

            else if (key == 32) {
                camera.initialize();
            }
        }
    });

    window.addEventListener('keyup', function(e) {
        var key = e.which;

        if (keysDown[key]) {
            window.cancelAnimationFrame(keysDown[key]);
            delete keysDown[key];
        }
    });

    canvas.addEventListener('mousewheel', function(e) {
        scrollHandler(e.deltaY < 0 ? 1 : -1);
    });

    canvas.addEventListener('DOMMouseScroll', function(e){
        scrollHandler(e.detail < 0 ? 1 : -1);
    });

}

function TimeObject() {

    this.start = Date.now();
    this.previous = this.start;
    this.current = this.start;
    this.elapsedStart = 0;
    this.elapsedAnim = 0;

    this.calc = function() {
        this.current = Date.now();
        this.elapsedStart = (this.current - this.start) / 1000;
        this.elapsedAnim = (this.current - this.previous) / 1000;
        this.previous = this.current;
    };
}

function CameraHandler() {
    var cam = {
            pos: vec3.fromValues(0, 0, 0),
            forward: vec3.fromValues(1, 0, 0),
            right: vec3.fromValues(0, 1, 0),
            up: vec3.fromValues(0, 0, 1),
            fov: 1
        },

        input = {
            rotateX: 0,
            rotateY: 0,
            transForward: 0,
            transRight: 0,
            transUp: 0,
            zoom: 0
        },
        update = true,
        timeToNormalize = 0;

    cam.initialize = function() {
        cam.pos = vec3.fromValues(0, 0, 0);
        cam.fov = 1;
        update = true;
    };

    cam.rotate = function(dx, dy) {
        input.rotateX += dx;
        input.rotateY += dy;
        update = true;
    };

    cam.translate = function(forward, right, up) {
        input.transForward += forward;
        input.transRight += right;
        input.transUp += up;
        update = true;
    };

    cam.zoom = function(change) {
        cam.fov *= change;
        update = true;
    };

    cam.update = function() {
        if (update) {

            if (input.rotateX !== 0 || input.rotateY !== 0) {
                var rotation = quat.create();
                
                quat.setAxisAngle(rotation, cam.up, input.rotateX);
                vec3.transformQuat(cam.forward, cam.forward, rotation);
                vec3.transformQuat(cam.right, cam.right, rotation);

                quat.setAxisAngle(rotation, cam.right, input.rotateY);
                vec3.transformQuat(cam.forward, cam.forward, rotation);
                vec3.transformQuat(cam.up, cam.up, rotation);

                timeToNormalize++;
            }

            var distToSphere = 1 - vec3.length(cam.pos);
            if (input.transForward !== 0) vec3.scaleAndAdd(cam.pos, cam.pos, cam.forward, input.transForward*distToSphere);
            if (input.transRight !== 0) vec3.scaleAndAdd(cam.pos, cam.pos, cam.right, input.transRight*distToSphere);
            if (input.transUp !== 0) vec3.scaleAndAdd(cam.pos, cam.pos, cam.up, input.transUp*distToSphere);

            params.actualSensitivity = Math.min(constants.sensitivity.rotate * cam.fov, constants.sensitivity.rotate);

            if (timeToNormalize > 500) {
                vec3.cross(cam.right, cam.up, cam.forward);
                vec3.cross(cam.up, cam.forward, cam.right);
                timeToNormalize = 0;
            }
            
            for (var prop in input) {
                input[prop] = 0;
            }

            update = false;

            return true;
        }
        return false;
    };

    return cam;
}

function GLHandler() {
    var prog = makeProgram(gl, 'vertex-shader', 'fragment-shader', {
                              uniforms: ['u_aspectRatio', 'u_pixelSize', 'u_pos', 'u_forward', 'u_up', 'u_right', 'u_fov',
                                         'u_julia', 'u_iterations', 'u_time',
                                         'u_altColor', 'u_altColorIntensity', 'u_sphereShrink']
    });

    var positionAttrib = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(positionAttrib);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 0,
        0, 1,
        1, 1,
        1, 0]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(positionAttrib, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(prog);

    function updateUniforms() {
        gl.uniform1i(prog.u_iterations, params.iterations);
        gl.uniform1f(prog.u_altColor, params.altColor / 100);
        gl.uniform1f(prog.u_altColorIntensity, params.altColorIntensity);
        gl.uniform1f(prog.u_sphereShrink, params.sphereShrink / 100);
    }

    updateUniforms();

    return {
        updateCameraUniforms: function() {
            gl.uniform3fv(prog.u_pos, camera.pos);
            gl.uniform3fv(prog.u_forward, camera.forward);
            gl.uniform3fv(prog.u_up, camera.up);
            gl.uniform3fv(prog.u_right, camera.right);
            gl.uniform1f(prog.u_fov, camera.fov);
        },

        updateUniforms: updateUniforms,

        draw: function() {
            camera.update();
            gl.uniform1f(prog.u_aspectRatio, constants.aspectRatio);
            // gl.uniform2fv(prog.u_pixelSize, constants.pixelSize);
            gl.uniform3f(prog.u_julia, params.juliaX, params.juliaY, params.juliaZ);
            gl.uniform1f(prog.u_time, time.elapsedStart);
            gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
        }
    };
}

function initGui() {
    var gui = new dat.GUI(),
        controller = {
            rotationRate: 1,
            colorShiftRate: 1,
            sphereShrink: 100
        };

    gui.add(params, 'resolutionScale', 0.5, 2.0).step(0.1).name('Resolution').onChange(window.onresize);
    gui.add(params, 'iterations', 1, 64).step(1).name('Iterations').listen().onChange(program.updateUniforms);
    gui.add(params, 'juliaX', 0, 1).name('Rotation X').listen();
    gui.add(params, 'juliaY', 0, 1).name('Rotation Y').listen();

    var fractal = gui.addFolder('Fractal Parameters');
    fractal.add(controller, 'rotationRate', 0, 5).name('Rotation Rate').onChange(setrotationRate);
    fractal.add(params, 'altColor', 0, 100).step(1).name('Alt. Color').onChange(program.updateUniforms);
    fractal.add(params, 'altColorIntensity', 0, 32).step(1).name('Alt. Color Intensity').onChange(program.updateUniforms);
    fractal.add(params, 'sphereShrink', 0, 4).step(0.01).name('Sphere Shrink').onChange(program.updateUniforms);

    function setrotationRate() {
        params.rotationRate = Math.pow(controller.rotationRate, 3) / 2000;
    }
    setrotationRate();

}

function animate() {
    time.calc();
    if (camera.update()) {
        program.updateCameraUniforms();
    }
    params.juliaZ = (params.juliaZ + params.rotationRate*time.elapsedAnim) % 1;
    program.draw();

    window.requestAnimationFrame(animate);
}

function makeProgram(gl, vertexShaderID, fragmentShaderID, params) {

    function compileAndCheck(program, shader, source) {
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.log(gl.getShaderInfoLog(shader));
        }
        gl.attachShader(program, shader);
    }

    var program = gl.createProgram();

    var vertexShader = gl.createShader(gl.VERTEX_SHADER);
    compileAndCheck(program, vertexShader, document.getElementById(vertexShaderID).innerHTML);

    var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    compileAndCheck(program, fragmentShader, document.getElementById(fragmentShaderID).innerHTML);

    gl.linkProgram(program);

    if (params && params.uniforms) {
        for (var i = 0; i < params.uniforms.length; i++) {
            program[params.uniforms[i]] = gl.getUniformLocation(program, params.uniforms[i]);
        }
    }

    return program;
}

function mod(x, m) {
    return (x % m + m) % m;
}

})();

