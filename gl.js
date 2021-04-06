/*

	WebGL 2 wrapper.
	Written by Cosmin Apreutesei.

	Canvas

		gl.clear_all(r, g, b, [a=1], [depth=1])

	Programs

		gl.module(name, code)

		gl.program(name, vs_code, fs_code) -> prog

		prog.set_uni(name, f | v2 | v3 | v4 | x,[y,[z,[w]]])
		prog.set_uni(name, tex, [texture_unit=0])

	VBOs

		gl.[dyn_][arr_]<type>_[instance_]buffer([data|capacity]) -> [d][a]b
			type: f32|u8|u16|u32|i8|i16|i32|v2|v3|v4|mat3|mat4
		gl.[dyn_][arr_][<type>_]index_buffer(data|capacity, [type|max_idx]) -> [d][a]b
			type: u8|u16|u32
		gl.dyn_arr_vertex_buffer({name->type}) -> davb

		b.upload(in_arr, [offset=0], [len], [in_offset=0])
		b.download(out_arr, [offset=0], [len], [out_offset=0])
		b.set(in_b, [offset=0], [len], [in_offset=0])
		b.arr([data|len]) -> a
		b.len

		db.buffer
		db.grow_type(arr|[...]|u8arr|u16arr|u32arr|max_idx)
		db.len

		dab.buffer
		dab.array
		dab.grow_type
		dab.len
		dab.set
		dab.get
		dab.invalidate
		dab.upload

		davb.len
		davb.<name> -> dab
		davb.to_vao(vao)

	UBOs

		prog.ubo(ub_name) -> ubo
		ubo.set(field_name, val)
		ubo.values = {name->val}
		ubo.upload()
		gl.bind_ubo(ubo[, slot])
		prog.bind_ubo(ub_name[, slot])

	VAOs

		prog.vao() -> vao
		vao.use()
		vao.set_attrs(davb)
		vao.set_attr(name, b)
		vao.set_index(b)
		vao.unuse()
		vao.dab(attr_name, [cap]) -> dab

	Textures

		gl.texture(['cubemap']) -> tex
		tex.set_rgba(w, h, pixels, [side])
		tex.set_u32(w, h, values, [side])
		tex.set_depth(w, h, [f32])
		tex.set_image(image, [pixel_scale], [side])
		tex.load(url, [pixel_scale], [on_load])

	RBOs

		gl.rbo() -> rbo
		rbo.set_rgba(w, h, [n_samples|multisampling])
		rbo.set_depth(w, h, [f32], [n_samples|multisampling])

	FBOs

		gl.fbo() -> fbo
		fbo.bind('read', 'none|back|color', [color_unit=0])
		fbo.bind(['draw'], [ 'none'|'back'|'color'|['none'|'back'|'color',...] ])
		fbo.attach(tex|rbo, 'color|depth|depth_stencil', [color_unit])
		fbo.clear_color(color_unit, r, g, b, [a=1])
		fbo.clear_depth_stencil([depth=1], [stencil=0])
		gl.read_pixels(attachment, color_unit, [buf], [x, y, w, h])
		gl.blit(
			[src_fbo], 'back|color', [color_unit],
			[dst_fbo], [ 'none'|'back'|'color'|['none'|'back'|'color',...] ],
			['color depth stencil'], ['nearest|linear'],
			[sx0], [sy0], [sx1], [sy1],
			[dx0], [dy0], [dx1], [dy1])

	Freeing

		prog|b|db|dab|davb|ubo|vao|tex|rbo|fbo.free()

*/

(function() {

let gl = WebGL2RenderingContext.prototype

// debugging -----------------------------------------------------------------

let methods = {}
let constant_names = {}
for (let name in gl) {
	let d = Object.getOwnPropertyDescriptor(gl, name)
	if (isfunc(d.value) && name != 'getError')
		methods[name] = d.value
	else if (isnum(d.value))
		constant_names[d.value] = name
}

function count_call(name, args, t) {
	if (name == 'useProgram' && args[0])
		name = name + ' ' + args[0].name
	if (name.starts('uniform'))
		name = name + ' ' + args[0].name
	t[name] = (t[name] || 0) + 1
	t._n++
}

gl.wrap_calls = function() {
	for (let name in methods) {
		let f = methods[name]
		this[name] = function(...args) {
			if (this._trace)
				count_call(name, args, this._trace)
			let ret = f.call(this, ...args)
			let err = this.getError()
			assert(!err, '{0}: {1}', name, constant_names[err])
			return ret
		}
	}
	this.wrap_calls = noop
	return this
}

gl.start_trace = function() {
	this.wrap_calls()
	this._trace = {_n: 0, _t0: time()}
}

gl.stop_trace = function() {
	let t = this._trace
	this._trace = null
	t._t1 = time()
	t._dt_ms = (t._t1 - t._t0) * 1000
	return t
}

// clearing ------------------------------------------------------------------

gl.clear_all = function(r, g, b, a, depth) {
	let gl = this
	if (gl.draw_fbo) {
		// NOTE: not using gl.clear(gl.COLOR_BUFFER_BIT) on a FBO because that
		// clears _all_ color buffers, which we don't want (we clear the
		// secondary color buffers separately with a different value).
		if (r != null)
			gl.draw_fbo.clear_color(0, r, g, b, a)
		gl.draw_fbo.clear_depth_stencil(depth)
	} else {
		if (r != null)
			gl.clearColor(r, g, b, or(a, 1))
		gl.clearDepth(or(depth, 1))
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
	}
	gl.enable(gl.DEPTH_TEST)
	gl.depthFunc(gl.LEQUAL)
	gl.enable(gl.POLYGON_OFFSET_FILL)
	return this
}

// shaders & VAOs ------------------------------------------------------------

let outdent = function(s) {
	s = s
		.replaceAll('\r', '')
		// trim line ends.
		.replaceAll(/[\t ]+\n/g, '\n')
		.replace(/[\t ]+$/, '')
		// trim text of empty lines.
		.replace(/^\n+/, '')
		.replace(/\n+$/, '')
	let indent = s.match(/^[\t ]*/)[0]
	return s.replace(indent, '').replaceAll('\n'+indent, '\n')
}

gl.module = function(name, s) {
	let t = attr(this, 'includes')
	assert(t[name] == null, 'module already exists: {0}', name)
	t[name] = outdent(s)
}

let preprocess = function(gl, code, included) {
	return ('\n' + outdent(code))
		.replaceAll(/\n#include[ \t]+([^\n]+)/g, function(_, name) {
			if (included[name])
				return ''
			included[name] = true
			let inc_code = attr(gl, 'includes')[name]
			assert(inc_code, 'include not found: {0}', name)
			return '\n'+preprocess(gl, inc_code, included)+'\n'
		}).replace(/^\n/, '')
}

let linenumbers = function(s, errors) {
	let t = map()
	for (let match of errors.matchAll(/ERROR\: 0\:(\d+)\: ([^\n]+)/g))
		t.set(num(match[1]), match[2])
	let i = 0
	s = ('\n' + s).replaceAll(/\n/g, function() {
		i++
		return '\n' + (t.has(i) ? t.get(i) + '\n' + '!' : ' ') + (i+'').padStart(4, ' ') + '  '

	}).slice(1)
	return s
}

gl.shader = function(type, name, gl_type, code) {
	let gl = this

	let shader = gl.createShader(gl_type)
	shader.code = code
	shader.raw_code = preprocess(gl, code, {})
	gl.shaderSource(shader, shader.raw_code)
	gl.compileShader(shader)

	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		let errors = gl.getShaderInfoLog(shader)
		print(errors)
		print(linenumbers(shader.raw_code, errors))
		gl.deleteShader(shader)
		assert(false, '{0} shader compilation failed for program {1}', type, name)
	}

	return shader
}

let prog = WebGLProgram.prototype

let btinfo_by_gl_type = {}
let btinfo_by_type = {}
for (let [gl_type, type, arr_type, nc, val_gl_type] of [
	[gl.FLOAT         , 'f32' , f32arr,  1],
	[gl.UNSIGNED_BYTE , 'u8'  , u8arr ,  1],
	[gl.UNSIGNED_SHORT, 'u16' , u16arr,  1],
	[gl.UNSIGNED_INT  , 'u32' , u32arr,  1],
	[gl.BYTE          , 'i8'  , i8arr ,  1],
	[gl.SHORT         , 'i16' , i16arr,  1],
	[gl.INT           , 'i32' , i32arr,  1],
	[gl.FLOAT_VEC2    , 'v2'  , f32arr,  2, gl.FLOAT],
	[gl.FLOAT_VEC3    , 'v3'  , f32arr,  3, gl.FLOAT],
	[gl.FLOAT_VEC4    , 'v4'  , f32arr,  4, gl.FLOAT],
	[gl.FLOAT_MAT3    , 'mat3', f32arr,  9, gl.FLOAT],
	[gl.FLOAT_MAT4    , 'mat4', f32arr, 16, gl.FLOAT],
]) {
	let info = {
		gl_type: gl_type,
		val_gl_type: gl_type,
		type: type,
		arr_type: arr_type,
		nc: nc,
	}
	btinfo_by_gl_type[gl_type] = info
	btinfo_by_type[type] = info
}

function btinfo(type) {
	assert(type, 'type required')
	return assert(btinfo_by_type[type], 'unknown type {1}', type)
}

gl.program = function(name, vs_code, fs_code) {
	let gl = this

	let pr = attr(gl, 'programs')[assert(isstr(name), 'program name required')]
	if (pr) {
		assert(pr.vs.code == vs_code)
		assert(pr.fs.code == fs_code)
		return pr
	}

	let vs = gl.shader('vertex'  , name, gl.VERTEX_SHADER  , vs_code)
	let fs = gl.shader('fragment', name, gl.FRAGMENT_SHADER, fs_code)
	pr = gl.createProgram()
	gl.attachShader(pr, vs)
	gl.attachShader(pr, fs)
	gl.linkProgram(pr)
	gl.validateProgram(pr)

	if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
		print(gl.getProgramInfoLog(pr))
		print('VERTEX SHADER')
		print(vs_code)
		print('FRAGMENT SHADER')
		print(fs_code)
		gl.deleteProgram(pr)
		gl.deleteShader(vs)
		gl.deleteShader(fs)
		assert(false, 'linking failed for program {0}', name)
	}

	// uniforms RTTI.
	pr.uniform_count = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS)
	pr.uniform_info = {} // {name->info}
	let u_info_by_index = {} // {uniform_index->info}
	for (let i = 0, n = pr.uniform_count; i < n; i++) {
		let info = gl.getActiveUniform(pr, i)
		pr.uniform_info[info.name] = info
		u_info_by_index[i] = info
		info.location = gl.getUniformLocation(pr, info.name)
		if (info.location)
			info.location.name = info.name
	}

	// UBO RTTI.
	pr.uniform_block_count = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORM_BLOCKS)
	pr.uniform_blocks = {} // {name->info}
	for (let ubi = 0, ubn = pr.uniform_block_count; ubi < ubn; ubi++) {
		let ub_name = gl.getActiveUniformBlockName(pr, ubi)
		let ub_info = {name: ub_name, fields: {}, index: ubi}
		pr.uniform_blocks[ub_name] = ub_info
		ub_info.size = gl.getActiveUniformBlockParameter(pr, ubi, gl.UNIFORM_BLOCK_DATA_SIZE)
		let uis = gl.getActiveUniformBlockParameter(pr, ubi, gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES)
		let ubos = gl.getActiveUniforms(pr, uis, gl.UNIFORM_OFFSET)
		for (let i = 0, n = uis.length; i < n; i++) {
			let u_info = u_info_by_index[uis[i]]
			u_info.ub_offset = ubos[i]
			ub_info.fields[u_info.name] = u_info
		}
	}

	// attrs RTTI.
	pr.attr_info = {}
	pr.attr_count = gl.getProgramParameter(pr, gl.ACTIVE_ATTRIBUTES)
	for (let i = 0, n = pr.attr_count; i < n; i++) {
		let ainfo = gl.getActiveAttrib(pr, i)
		let name = ainfo.name
		let size = ainfo.size
		let gl_type = ainfo.type
		let location = gl.getAttribLocation(pr, name)
		let info = assign({
				name: name,
				size: size,
				location: location,
				program: pr,
			}, btinfo_by_gl_type[gl_type])
		pr.attr_info[name] = info
		pr.attr_info[location] = info
	}

	pr.gl = gl
	pr.vs = vs
	pr.fs = fs
	pr.name = name
	gl.programs[name] = pr

	return pr
}

prog.use = function() {
	let gl = this.gl
	if (gl.active_program != this) {

		gl.useProgram(this)
		gl.active_program = this

		if (gl.ubos) { // bind global UBOs matching on name.
			for (let ub_name in this.uniform_blocks) {
				let ubo = gl.ubos[ub_name]
				this.bind_ubo(ub_name, ubo.slot)
			}
		}

	}
	return this
}

prog.unuse = function() {
	let gl = this.gl
	assert(gl.active_program == this, 'program not in use: {0}', this.name)
	gl.useProgram(null)
	gl.active_program = null
}

prog.free = function() {
	let pr = this
	let gl = pr.gl
	if (gl.active_vao && gl.active_vao.program == this)
		gl.active_vao.unbind()
	for (let vao of this.vaos)
		gl.deleteVertexArray(vao)
	if (gl.active_program == this)
		this.unuse()
	delete gl.programs[pr.name]
	gl.deleteProgram(pr)
	gl.deleteShader(pr.vs)
	gl.deleteShader(pr.fs)
	this.free = noop
}

let vao = WebGLVertexArrayObject.prototype

// shared VAO: works with multiple programs but requires hardcoded attr. locations.
gl.vao = function(programs) {
	let gl = this
	let vao = gl.createVertexArray()
	vao.gl = gl
	vao.programs = assert(programs, 'programs required')
	vao.attr_info = {}
	for (let prog of programs) {
		for (let name of prog.attr_info) {
			let info = prog.attr_info[name]
			let info0 = vao.attr_info[name]
			if (!info0) {
				info.program = prog
				vao.attr_info[name] = info
			} else {
				assert(info0.type == info.type, 'type mismatch {0} from {1} vs {2} from {3}',
					info.type, prog, info0.type, info0.program.name)
				assert(info0.location == info.location, 'location mismatch {0} from {1} vs {2} from {3}',
					info.location, prog, info0.location, info0.program.name)
			}
		}
	}
	return vao
}

// program-specific VAO: only with the program that created it.
prog.vao = function() {
	let gl = this.gl
	let vao = gl.createVertexArray()
	vao.gl = gl
	vao.program = this
	vao.attr_info = this.attr_info
	if (!this.vaos)
		this.vaos = []
	this.vaos.push(vao)
	return vao
}

vao.bind = function() {
	let gl = this.gl
	if (this != gl.active_vao) {
		assert(!gl.active_program || !this.program || gl.active_program == this.program,
			'different active program')
		gl.bindVertexArray(this)
		gl.active_vao = this
	}
}

vao.unbind = function() {
	let gl = this.gl
	assert(gl.active_vao == this, 'vao not bound')
	gl.bindVertexArray(null)
	gl.active_vao = null
}

vao.use = function() {
	let gl = this.gl
	if (this.program) {
		this.program.use()
	} else {
		assert(gl.active_program, 'no active program for shared VAO')
	}
	this.bind()
	return this
}

vao.unuse = function() {
	this.unbind()
	this.program.unuse()
}

vao.set_attr = function(name, b) {
	let gl = this.gl

	let bound = gl.active_vao == this
	assert(bound || !gl.active_vao)

	let info = this.attr_info[name]
	if (info == null)
		return this

	let buffers = attr(this, 'buffers')
	let b0 = buffers[name]
	if (b0 == b)
		return this

	if (!bound)
		this.bind()

	gl.bindBuffer(gl.ARRAY_BUFFER, b)

	let loc = info.location
	let gl_type = or(info.val_gl_type, info.gl_type)
	let nc = info.nc
	let nloc = min(1, nc >> 2)

	if (!b != !b0) {
		for (let i = 0; i < nloc; i++)
			if (b)
				gl.enableVertexAttribArray(loc+i)
			else
				gl.disableVertexAttribArray(loc+i)
	}

	let config = attr(this, 'config')
	if (b && !config[name]) {
		if (info.type == 'i32' || info.type == 'u32') {
			gl.vertexAttribIPointer(loc, nc, gl_type, 0, 0)
		} else if (nloc > 1) {
			let sz = nloc * 4
			for (let i = 0; i < nloc; i++)
				gl.vertexAttribPointer(loc+i, nc, gl_type, false, n * sz, i * sz)
		} else {
			gl.vertexAttribPointer(loc, nc, gl_type, false, 0, 0)
		}
		config[name] = true
	}

	if ((b && b.inst_div || 0) != (b0 && b0.inst_div || 0))
		for (let i = 0; i < nloc; i++)
			gl.vertexAttribDivisor(loc+i, b && b.inst_div || 0)

	if (!bound)
		this.unbind()

	buffers[name] = b

	return this
}

vao.set_attrs = function(davb) {
	assert(davb.is_dyn_arr_vertex_buffer)
	davb.to_vao(this)
	return this
}

property(vao, 'vertex_count', function() {
	let min_len
	if (this.buffers)
		for (let name in this.buffers) {
			let b = this.buffers[name]
			if (!b.inst_div)
				min_len = min(or(min_len, 1/0), b.len)
		}
	return min_len || 0
})

property(vao, 'instance_count', function() {
	let min_len
	if (this.buffers)
		for (let name in this.buffers) {
			let b = this.buffers[name]
			if (b.inst_div)
				min_len = min(or(min_len, 1/0), b.len)
		}
	return min_len || 0
})

vao.set_index = function(b) {
	let gl = this.gl
	let bound = gl.active_vao == this
	assert(bound || !gl.active_vao)
	if (!bound)
		this.bind()
	if (this.index_buffer != b) {
		assert(b.for_index, 'not an index buffer')
		this.index_buffer = b
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b)
	}
	if (!bound)
		this.unbind()
	return this
}

vao.free = function() {
	this.gl.deleteVertexArray(this)
	this.program.vaos.remove_value(this)
	this.free = noop
}

gl.vao_set = function() {
	let vaos = {}
	let e = {}
	e.vao = function(prog) {
		let vao = vaos[prog.name]
		if (!vao) {
			vao = prog.vao()
			vaos[prog.name] = vao
		}
		return vao
	}
	e.free = function() {
		for (let prog_name in vaos)
			vaos[prog_name].free()
		vaos = null
	}
	return e
}

// VBOs ----------------------------------------------------------------------

function check_arr_type(arr, arr_type) {
	if (!arr_type)
		return arr.constructor
	assert(arr instanceof arr_type,
		'different arr_type {0}, expected {1}', arr.constructor.name, arr_type.name)
	return arr_type
}

function check_arr_nc(arr, nc) {
	let arr_nc = arr.nc
	nc = or(or(nc, arr_nc), 1)
	assert(or(arr_nc, nc) == nc, 'different number of components {0}, expected {1}', arr_nc, nc)
	return nc
}

function check_arr_len(nc, arr, len, arr_offset) {
	if (len == null)
		if (arr.len != null) // dyn_arr
			len = arr.len - arr_offset
	if (len == null) {
		len = arr.length / nc - arr_offset
		assert(len == floor(len), 'array length not multiple of {0}', nc)
	}
	return max(0, len)
}

gl.buffer = function(data_or_cap, type, inst_div, for_index) {
	let gl = this

	inst_div = inst_div || 0
	assert(inst_div == 0 || inst_div == 1, 'NYI: inst_div != 1')
	let info, cap, len, arg
	if (isnum(data_or_cap)) { // capacity, type, ...
		info = btinfo(type)
		cap = data_or_cap
		len = 0
		arg = cap * info.nc * info.arr_type.BYTES_PER_ELEMENT
	} else if (isarray(data_or_cap)) { // [elements, ...], type, ...
		info = btinfo(type)
		cap = check_arr_len(info.nc, data_or_cap, null, 0)
		len = cap
		arg = new info.arr_type(arg)
	} else { // arr, [type], ...
		check_arr_type(arg, type)
		arg = data_or_cap
		nc = check_arr_nc(arg, nc)
	}

	let gl_target = for_index ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER

	let b = gl.createBuffer()
	gl.bindBuffer(gl_target, b)
	gl.bufferData(gl_target, arg, gl.STATIC_DRAW)

	b.gl = gl
	b.capacity = cap
	b._len = len
	assign(b, info)
	b.for_index = for_index
	b.inst_div = inst_div

	return b
}

property(WebGLBuffer, 'len',
	function() { return this._len },
	function(len) {
		assert(len <= this.capacity, 'len exceeds capacity')
		this._len = len
	}
)

function index_arr_type(data_or_cap, type_or_max_idx, fname) {
	if (isstr(type_or_max_idx))
		type_or_max_idx = assert(btinfo(type_or_max_idx, fname).arr_type)
	return dyn_arr.index_arr_type(or(type_or_max_idx, or(data_or_cap, 0)))
}

gl.index_buffer = function(data_or_cap, type_or_max_idx) {
	let arr_type = index_arr_type(data_or_cap, type_or_max_idx, 'index_buffer()')
	return this.buffer(data_or_cap, arr_type, null, true)
}

let buf = WebGLBuffer.prototype

buf.arr = function(data_or_len) {
	if (data_or_len == null)
		data_or_len = this.len
	let nc = this.nc
	if (isnum(data_or_len))
		data_or_len = data_or_len * nc
	else
		check_arr_nc(data_or_len, nc)
	let arr = new this.arr_type(data_or_len)
	arr.nc = this.nc
	return arr
}

buf.upload = function(in_arr, offset, len, in_offset) {
	let gl = this.gl
	let nc = this.nc
	if (isarray(in_arr)) { // [...], ...
		in_arr = new this.arr_type(in_arr)
	} else { // arr, ...
		check_arr_type(in_arr, this.arr_type)
	}
	check_arr_nc(in_arr, nc)
	offset = offset || 0
	in_offset = in_offset || 0
	assert(offset >= 0)
	assert(in_offset >= 0)
	len = check_arr_len(nc, in_arr, len, in_offset)
	let bpe = in_arr.BYTES_PER_ELEMENT

	gl.bindBuffer(gl.COPY_READ_BUFFER, this)
	gl.bufferSubData(gl.COPY_READ_BUFFER, offset * nc * bpe, in_arr, in_offset * nc, len * nc)

	this._len = max(this._len, offset + len)

	return this
}

buf.download = function(out_arr, offset, len, out_offset) {
	let gl = this
	let nc = this.nc
	check_arr_type(out_arr, this.arr_type)
	check_arr_nc(out_arr, nc)
	offset = offset || 0
	out_offset = out_offset || 0
	assert(offset >= 0)
	assert(out_offset >= 0)
	if (len == null)
		len = this.len - offset // source dictates len, dest must accomodate.
	let bpe = out_arr.BYTES_PER_ELEMENT

	gl.bindBuffer(gl.COPY_READ_BUFFER, this)
	gl.getBufferSubData(gl.COPY_READ_BUFFER, offset * nc * bpe, out_arr, out_offset * nc, len * nc)

	return out_arr
}

buf.set = function(in_buf, offset, len, in_offset) {
	let gl = this.gl
	let nc = this.nc
	check_arr_type(in_buf, this.arr_type)
	check_arr_nc(in_buf, nc)
	offset = offset || 0
	in_offset = in_offset || 0
	assert(offset >= 0)
	assert(out_offset >= 0)
	if (len == null)
		len = in_buf.len - in_offset
	let bpe = this.BYTES_PER_ELEMENT

	gl.bindBuffer(gl.COPY_READ_BUFFER, in_buf)
	gl.bindBuffer(gl.COPY_WRITE_BUFFER, this)
	gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER,
		in_offset * nc * bpe,
		offset * nc * bpe,
		len * nc * bpe)

	this._len = max(this._len, offset + len)

	return this
}

buf.free = function() {
	this.gl.deleteBuffer(this)
}

gl.dyn_buffer = function(type, data_or_cap, inst_div, for_index) {

	let info = btinfo(type)
	let gl = this
	let db = {
		is_dyn_buffer: true,
		gl: gl,
		type: type,
		inst_div: inst_div,
		for_index: for_index,
		buffer: null,
		buffer_replaced: noop,
	}

	db.grow_type = function(arg) {
		let arr_type1 = index_arr_type(null, arg, 'grow_type()')
		let info1 = btinfo(arr_type1)
		assert(info1.nc == info.nc)
		if (info1.arr_type.BYTES_PER_ELEMENT <= info.arr_type.BYTES_PER_ELEMENT)
			return
		if (this.buffer) {
			let a1
			if (this.len > 0) {
				let a0 = this.buffer.download(this.buffer.arr())
				let a1 = new arr_type1(this.len)
				for (let i = 0, n = a0.length * nc; i < n; i++)
					a1[i] = a0[i]
			}
			let cap = this.buffer.capacity
			this.buffer.free()
			this.buffer = gl.buffer(cap, arr_type1, inst_div, for_index)
			if (a1)
				this.buffer.upload(a1)
			this.buffer_replaced(this.buffer)
		}
		info = info1
		this.type = info.type
	}

	db._grow = function(cap, pow2) {
		cap = max(0, cap)
		if ((this.buffer ? this.buffer.capacity : 0) < cap) {
			if (pow2 !== false)
				cap = nextpow2(cap)
			let b0 = this.buffer
			let b1 = gl.buffer(cap, arr_type, inst_div, for_index)
			if (b0) {
				b1.set(b0)
				b0.free()
			}
			this.buffer = b1
			this.buffer_replaced(b1)
		}
		return this
	}

	db.free = function() {
		this.buffer.free()
		this.buffer = null
	}

	property(db, 'len',
		function() {
			return db.buffer && db.buffer.len || 0
		},
		function(len) {
			len = max(0, len)
			let buffer = db._grow(len).buffer
			if (buffer)
				buffer.len = len
		}
	)

	if (data_or_cap != null) {
		if (isnum(data_or_cap)) {
			let cap = data_or_cap
			db._grow(cap)
		} else {
			let data = data_or_cap
			let len = data.length / nc
			assert(len == floor(len), 'source array length not multiple of {0}', nc)
			db.buffer = gl.buffer(data, arr_type, nc, inst_div, for_index)
		}
	}

	return db
}

gl.dyn_index_buffer = function(data_or_cap, type_or_max_idx) {
	let arr_type = index_arr_type(data_or_cap, type_or_max_idx, 'dyn_index_buffer()')
	return this.dyn_buffer(arr_type, data_or_cap, null, false, true)
}

gl.dyn_arr_buffer = function(arr_type, data_or_cap, inst_div, for_index) {

	let dab = {is_dyn_arr_buffer: true}
	let db = this.dyn_buffer(arr_type, data_or_cap, inst_div, for_index)
	let da = dyn_arr(arr_type, data_or_cap)

	dab.buffer_replaced = noop
	db.buffer_replaced = function(b) { dab.buffer_replaced(b) }

	property(dab, 'len',
		function() { return da.len },
		function(len) { da.len = len }
	)

	dab.grow_type = function(arg) {
		da.grow_type(arg)
		db.grow_type(arg)
		return this
	}

	dab.set = function(in_arr, offset, len, in_offset) {
		da.set(in_arr, offset, len, in_offset)
		return this
	}

	dab.get = function(out_arr, offset, len, out_offset) {
		return da.get(out_arr, offset, len, out_offset)
	}

	dab.invalidate = function(offset, len) {
		da.invalidate(offset, len)
		return this
	}

	dab.upload = function() {
		db.len = da.len
		if (db.buffer)
			db.buffer.upload(da.array)
		da.validate()
		return this
	}

	dab.upload_invalid = function() {
		if (!da.invalid)
			return
		db.len = da.len
		db.buffer.upload(da.array, da.invalid_offset1, da.invalid_offset2 - da.invalid_offset1)
		da.validate()
		return this
	}

	property(dab, 'array', () => da.array)
	property(dab, 'buffer', () => db.buffer)

	return dab
}

gl.dyn_arr_index_buffer = function(data_or_cap, type_or_max_idx) {
	let type = index_arr_type(data_or_cap, type_or_max_idx, 'dyn_arr_index_buffer()')
	return this.dyn_arr_buffer(type, data_or_cap, null, false, true)
}

// generate gl.*_buffer() APIs.
for (let type in btinfo_by_type) {
	gl[type+'_buffer'] = function buffer(data_or_cap) {
		return this.buffer(data_or_cap, type)
	}
	gl[type+'_instance_buffer'] = function instance_buffer(data_or_cap) {
		return this.buffer(data_or_cap, type, 1)
	}
	gl['dyn_'+type+'_buffer'] = function dyn_buffer(data_or_cap) {
		return this.dyn_buffer(type, data_or_cap)
	}
	gl['dyn_'+type+'_instance_buffer'] = function dyn_instance_buffer(data_or_cap) {
		return this.dyn_buffer(type, data_or_cap, 1)
	}
	gl['dyn_arr_'+type+'_buffer'] = function dyn_arr_buffer(data_or_cap) {
		return this.dyn_arr_buffer(type, data_or_cap)
	}
	gl['dyn_arr_'+type+'_instance_buffer'] = function dyn_arr_instance_buffer(data_or_cap) {
		return this.dyn_arr_buffer(type, data_or_cap, 1)
	}
}

// generate gl.*_index_buffer() APIs.
for (let type of ['u8', 'u16', 'u32']) {
	let arr_type = btinfo_by_type[type].arr_type
	gl[type+'_index_buffer'] = function index_buffer(data_or_cap) {
		return this.index_buffer(data_or_cap, arr_type)
	}
	gl['dyn_'+type+'_index_buffer'] = function dyn_index_buffer(data_or_cap) {
		return this.dyn_index_buffer(data_or_cap, arr_type)
	}
	gl['dyn_arr_'+type+'_index_buffer'] = function dyn_arr_index_buffer(data_or_cap) {
		return this.dyn_arr_index_buffer(data_or_cap, arr_type)
	}
}

vao.dab = function(name, cap) {
	let vao = this
	let info = assert(vao.program.attr_info[name], 'invalid attribute {0}', name)
	let dab = vao.gl.dyn_arr_buffer(info.type, cap)
	if (dab.buffer)
		vao.set_attr(name, dab.buffer)
	dab.buffer_replaced = function(b) { vao.set_attr(name, b) }
	return dab
}

gl.dyn_arr_vertex_buffer = function(attrs, cap) {

	let e = {dabs: {}, is_dyn_arr_vertex_buffer: true}

	let dab0
	for (let name in attrs) {
		let type = attrs[name]
		let info = btinfo(type)
		let dab = this.dyn_arr_buffer(info.type, cap)
		e.dabs[name] = dab
		e[name] = dab
		dab0 = dab0 || dab
	}

	property(e, 'len',
		function() {
			return dab0.len
		},
		function(len) {
			for (let name in e.dabs) {
				let dab = e.dabs[name]
				dab.len = len
			}
		}
	)

	e.upload = function() {
		for (let name in e.dabs)
			e.dabs[name].upload()
	}

	e.to_vao = function(vao) {
		for (let name in e.dabs)
			vao.set_attr(name, e.dabs[name].buffer)
	}

	e.free = function() {
		for (let name in e.dabs)
			e.dabs[name].free()
	}

	return e
}

// UBOs ----------------------------------------------------------------------

prog.ub_info = function(ub_name) {
	return assert(this.uniform_blocks[ub_name], 'invalid uniform block {0}', ub_name)
}

prog.ubo = function(ub_name) {
	let gl = this.gl

	let ub = this.ub_info(ub_name)

	let buf = gl.buffer(ub.size)
	let arr = new ArrayBuffer(ub.size)
	let arr_u8  = new u8arr(arr)
	let arr_f32 = new f32arr(arr)
	let arr_i32 = new i32arr(arr)

	let ubo = {program: this, name: ub_name, buffer: buf, values: {}}

	ubo.set = function(name, val) {
		if (!ub.fields[name])
			return
		this.values[name] = val
	}

	ubo.upload = function() {
		let set_one
		for (let name in this.values) {
			let val = this.values[name]
			let u_info = ub.fields[name]
			let gl_type = u_info.type
			let offset = u_info.ub_offset >> 2
			if (
				   gl_type == gl.INT
				|| gl_type == gl.BOOL
				|| gl_type == gl.SAMPLER_2D
				|| gl_type == gl.SAMPLER_CUBE
			) {
				arr_i32[offset] = val
			} else if (gl_type == gl.FLOAT) {
				arr_f32[offset] = val
			} else if (
				   gl_type == gl.FLOAT_VEC2
				|| gl_type == gl.FLOAT_VEC3
				|| gl_type == gl.FLOAT_VEC4
				|| gl_type == gl.FLOAT_MAT3
				|| gl_type == gl.FLOAT_MAT4
			) {
				arr_f32.set(val, offset)
			} else {
				assert(false, 'NYI: {2} field (program {0} ubo {0} field {1})',
					this.name, ub_name, name, constant_names[gl_type])
			}
			delete this.values[name]
			set_one = true
		}
		if (set_one)
			buf.upload(arr_u8)
	}
	return ubo
}

prog.bind_ubo = function(ub_name, slot) {
	let gl = this.gl
	let ubi = this.ub_info(ub_name).index
	let ubs = attr(this, 'ubo_bindings')
	if (slot == null) {
		let ubo = gl.ubos && gl.ubos[ub_name]
		slot = assert(ubo && ubo.slot, 'no name-bound UBO {0}', ub_name)
	}
	if (ubs[ub_name] != slot) {
		gl.uniformBlockBinding(this, ubi, slot)
		ubs[ub_name] = slot
	}
	return this
}

gl.bind_ubo = function(ubo, slot) {
	let slots = attr(this, 'ubo_slots', Array)
	if (slot == null) { // name-based slot reservation.
		let ubos = attr(this, 'ubos')
		let ubo0 = ubos[ubo.name]
		this.next_ubo_slot = (this.next_ubo_slot || 0)
		slot = ubo0 ? ubo0.slot : (this.next_ubo_slot++)
		ubo.slot = slot
		ubos[ubo.name] = ubo
	} else {
		assert(!this.ubos, 'use of both explicit and name-based slot allocation')
	}
	if (slots[slot] != ubo) {
		this.bindBufferBase(gl.UNIFORM_BUFFER, slot, ubo && ubo.buffer)
		slots[slot] = ubo
	}
	return this
}

// setting uniforms and attributes and drawing -------------------------------

prog.uniform_location = function(name) {
	let info = this.uniform_info[name]
	return info && info.location
}

prog.set_uni_f = function(name, v) {
	let loc = this.uniform_location(name)
	if (loc)
		this.gl.uniform1f(loc, v || 0)
	return this
}

prog.set_uni_i = function(name, v) {
	let loc = this.uniform_location(name)
	if (loc)
		this.gl.uniform1i(loc, v || 0)
	return this
}

prog.set_uni_v2 = function(name, x, y) {
	let loc = this.uniform_location(name)
	if (loc) {
		if (x && (x.is_v2 || x.is_v3 || x.is_v4)) {
			let p = x
			x = p.x
			y = p.y
		}
		this.gl.uniform2f(loc, x || 0, y || 0)
	}
	return this
}

prog.set_uni_v3 = function(name, x, y, z) {
	let loc = this.uniform_location(name)
	if (loc) {
		if (x && (x.is_v3 || x.is_v4)) {
			let p = x
			x = p.x
			y = p.y
			z = p.z
		} else if (isnum(x) && y == null) { // 0xRRGGBB -> (r, g, b)
			let c = x
			x = (c >> 16 & 0xff) / 255
			y = (c >>  8 & 0xff) / 255
			z = (c       & 0xff) / 255
		}
		this.gl.uniform3f(loc, x || 0, y || 0, z || 0)
	}
	return this
}

prog.set_uni_v4 = function(name, x, y, z, w) {
	let loc = this.uniform_location(name)
	if (loc) {
		if (x && (x.is_v3 || x.is_v4)) {
			let p = x
			x = p.x
			y = p.y
			z = p.z
			w = p.w
		} else if (isnum(x) && y == null) { // 0xRRGGBBAA -> (r, g, b, a)
			let c = x
			x = (c >> 24       ) / 255
			y = (c >> 16 & 0xff) / 255
			z = (c >>  8 & 0xff) / 255
			w = (c       & 0xff) / 255
		}
		this.gl.uniform4f(loc, x || 0, y || 0, z || 0, or(w, 1))
	}
	return this
}

prog.set_uni_mat3 = function(name, m) {
	let loc = this.uniform_location(name)
	if (loc)
		this.gl.uniformMatrix3fv(loc, false, m || mat3f32.identity)
	return this
}

prog.set_uni_mat4 = function(name, m) {
	let loc = this.uniform_location(name)
	if (loc)
		this.gl.uniformMatrix4fv(loc, false, m || mat4f32.identity)
	return this
}

let set_uni_texture_func = function(target) {
	return function(name, tex, unit) {
		let loc = this.uniform_location(name)
		if (loc) {
			let gl = this.gl
			if (tex) {
				assert(tex.target == target,
					'texture target mismatch {0}, expected {1}', tex.target, target)
				tex.bind(unit)
			} else {
				gl.bind_texture(target, null, unit)
			}
			gl.uniform1i(loc, unit)
		}
		return this
	}
}
prog.set_uni_texture      = set_uni_texture_func('2d')
prog.set_uni_texture_cube = set_uni_texture_func('cubemap')

prog.set_uni = function(name, a, b, c, d) {
	let gl = this.gl
	let info = this.uniform_info[name]
	if (!info)
		return this
	if (info.type == gl.FLOAT)
		return this.set_uni_f(name, a)
	else if (info.type == gl.INT || info.type == gl.BOOL)
		return this.set_uni_i(name, a)
	else if (info.type == gl.FLOAT_VEC2)
		return this.set_uni_v2(name, a, b)
	else if (info.type == gl.FLOAT_VEC3)
		return this.set_uni_v3(name, a, b, c)
	else if (info.type == gl.FLOAT_VEC4)
		return this.set_uni_v4(name, a, b, c, d)
	else if (info.type == gl.FLOAT_MAT3)
		return this.set_uni_mat3(name, a)
	else if (info.type == gl.FLOAT_MAT4)
		return this.set_uni_mat4(name, a)
	else if (info.type == gl.SAMPLER_2D)
		return this.set_uni_texture(name, a, b)
	else if (info.type == gl.SAMPLER_CUBE)
		return this.set_uni_texture_cube(name, a, b)
	else
		assert(false, 'NYI: {2} uniform (program {0}, uniform {1})',
			this.name, name, constant_names[info.type])
}

gl.draw = function(gl_mode, offset, count) {
	let gl = this
	let vao = gl.active_vao
	let ib = vao.index_buffer
	let n_inst = vao.instance_count
	offset = offset || 0
	if (ib) {
		if (count == null)
			count = ib.len
		if (n_inst != null) {
			// NOTE: don't look for an offset-in-the-instance-buffers arg,
			// that's glDrawElementsInstancedBaseInstance() which is not exposed.
			gl.drawElementsInstanced(gl_mode, count, ib.gl_type, offset, n_inst)
		} else {
			gl.drawElements(gl_mode, count, ib.gl_type, offset)
		}
	} else {
		if (count == null)
			count = vao.vertex_count
		if (n_inst != null) {
			gl.drawArraysInstanced(gl_mode, offset, count, n_inst)
		} else {
			gl.drawArrays(gl_mode, offset, count)
		}
	}
	return this
}

gl.draw_triangles = function(o, n) { let gl = this; return gl.draw(gl.TRIANGLES, o, n) }
gl.draw_points    = function(o, n) { let gl = this; return gl.draw(gl.POINTS   , o, n) }
gl.draw_lines     = function(o, n) { let gl = this; return gl.draw(gl.LINES    , o, n) }

// textures ------------------------------------------------------------------

let tex = WebGLTexture.prototype

gl.texture = function(target) {
	let gl = this
	let tex = gl.createTexture()
	tex.gl = gl
	tex.target = target || '2d'
	return tex
}

let tex_gl_target = function(target) {
	return target == 'cubemap' && gl.TEXTURE_CUBE_MAP || gl.TEXTURE_2D
}

gl.bind_texture = function(target, tex1, unit) {
	let gl = this
	target = or(target, '2d')
	unit = unit || 0
	let units = attr(attr(gl, 'texture_units'), target, Array)
	let tex0 = units[unit]
	let gl_target = tex_gl_target(target)
	if (tex0 != tex1) {
		if (tex1) {
			assert(tex1.target == target,
			'texture target mismatch {0}, wanted {1}', tex1.target, target)
			tex1.gl_target = gl_target
		}
		if (tex0)
			tex0.unit = null

		gl.activeTexture(gl.TEXTURE0 + unit)
		gl.bindTexture(gl_target, tex1)

		units[unit] = tex1
		if (tex1)
			tex1.unit = unit
	}
	return this
}

gl.unbind_textures = function(target) {
	let all_units = gl.texture_units
	if (!all_units)
		return this
	if (!target) {
		this.unbind_textures('2d')
		this.unbind_textures('cubemap')
		return this
	}
	let units = all_units[target]
	if (!units)
		return this
	let gl_target = tex_gl_target(target)
	for (let i = 0, n = units.length; i < n; i++) {
		if (units[i]) {
			gl.activeTexture(gl.TEXTURE0 + unit)
			gl.bindTexture(gl_target, null)
		}
	}
	units.length = 0
}

tex.bind = function(unit) {
	this.gl.bind_texture(this.target, this, unit)
	return this
}

tex.unbind = function() {
	assert(this.unit != null, 'texture not bound')
	this.gl.bind_texture(this.target, null, this.unit)
	return this
}

tex.free = function() {
	let gl = this.gl
	this.gl.deleteTexture(this)
}

tex.set_depth = function(w, h, f32) {
	let gl = this.gl
	assert(this.gl_target == gl.TEXTURE_2D)

	this.bind()
	gl.texImage2D(gl.TEXTURE_2D, 0,
		f32 ? gl.DEPTH_COMPONENT32F : gl.DEPTH_COMPONENT24,
		w, h, 0, gl.DEPTH_COMPONENT, f32 ? gl.FLOAT : gl.UNSIGNED_INT, null)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
	this.unbind()

	this.w = w
	this.h = h
	this.format = 'depth'
	this.attach = 'depth'
	return this
}

let gl_cube_sides = {
	right  : gl.TEXTURE_CUBE_MAP_POSITIVE_X,
	left   : gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
	top    : gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
	bottom : gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
	front  : gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
	back   : gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,

	posx: gl.TEXTURE_CUBE_MAP_POSITIVE_X,
	negx: gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
	posy: gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
	negy: gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
	posz: gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
	negz: gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
}

let tex_side_target = function(tex, side) {
	if (tex.gl_target == gl.TEXTURE_CUBE_MAP)
		return assert(gl_cube_sides[side], 'invalid cube map texture side {0}', side)
	else {
		assert(!side)
		return tex.gl_target
	}
}

tex.set_rgba = function(w, h, pixels, side) {
	let gl = this.gl

	this.bind()
	gl.texImage2D(tex_side_target(this, side), 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
	this.unbind()

	this.w = w
	this.h = h
	this.format = 'rgba'
	this.attach = 'color'
	return this
}

tex.set_rgba16 = function(w, h, pixels, side) {
	let gl = this.gl

	this.bind()
	gl.texImage2D(tex_side_target(this, side), 0, gl.RGBA16UI, w, h, 0, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, pixels)
	this.unbind()

	this.w = w
	this.h = h
	this.format = 'rgba16'
	this.attach = 'color'
	return this
}

tex.set_u32 = function(w, h, pixels, side) {
	let gl = this.gl

	this.bind()
	gl.texImage2D(tex_side_target(this, side), 0, gl.R32UI, w, h, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, pixels)
	this.unbind()

	this.w = w
	this.h = h
	this.format = 'u32'
	this.attach = 'color'
	return this
}

let is_pow2 = function(value) {
	return (value & (value - 1)) == 0
}

tex.set_image = function(image, pixel_scale, side) {
	let gl = this.gl
	let gl_target = tex_side_target(this, side)

	this.bind()
	gl.texImage2D(gl_target, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
	if (gl_target == gl.TEXTURE_2D)
		gl.generateMipmap(gl_target)
	this.unbind()

	let w = image.width
	let h = image.height
	if (!side) {
		pixel_scale = or(pixel_scale, 1)
		this.uv = v2(
			1 / (w * pixel_scale),
			1 / (h * pixel_scale)
		)
		this.image = image
	} else {
		attr(this, 'images')[side] = image
	}
	this.w = w
	this.h = h
	this.format = 'rgba'
	this.attach = 'color'

	return this
}

let missing_pixel_rgba_1x1 = new u8arr([0, 0, 255, 255])

tex.load = function(url, pixel_scale, on_load, side) {
	let tex = this
	let gl = this.gl
	tex.set_rgba(1, 1, missing_pixel_rgba_1x1, side)
	let image = new Image()
	image.crossOrigin = ''
	image.onload = function() {
		tex.set_image(image, pixel_scale, side)
		tex.loading.remove_value(image)
		if (on_load)
			on_load(tex, image, side)
	}
	image.src = url
	attr(tex, 'loading', Array).push(image)
	return tex
}

let parse_wrap = function(s) {
	if (s == 'repeat') return gl.REPEAT
	if (s == 'clamp') return gl.CLAMP_TO_EDGE
	if (s == 'mirror') return gl.MIRRORED_REPEAT
	assert(false, 'invalid wrap value {0}', s)
}

tex.set_wrap = function(wrap_s, wrap_t) {
	let gl = this.gl
	wrap_t = or(wrap_t, wrap_s)

	this.bind()
	gl.texParameteri(this.gl_target, gl.TEXTURE_WRAP_S, parse_wrap(wrap_s))
	gl.texParameteri(this.gl_target, gl.TEXTURE_WRAP_T, parse_wrap(wrap_t))

	return this
}

let parse_filter = function(s) {
	if (s == 'nearest') return gl.NEAREST
	if (s == 'linear' ) return gl.LINEAR
	if (s == 'nearest_mipmap_nearest') return gl.NEAREST_MIPMAP_NEAREST
	if (s == 'linear_mipmap_nearest' ) return gl.LINEAR_MIPMAP_NEAREST
	if (s == 'nearest_mipmap_linear' ) return gl.NEAREST_MIPMAP_LINEAR // default
	if (s == 'linear_mipmap_linear'  ) return gl.LINEAR_MIPMAP_LINEAR
	assert(false, 'invalid filter value {0}', s)
}

tex.set_filter = function(min_filter, mag_filter) {
	let gl = this.gl

	this.bind()
	gl.texParameteri(this.gl_target, gl.TEXTURE_MIN_FILTER, parse_filter(min_filter))
	gl.texParameteri(this.gl_target, gl.TEXTURE_MAG_FILTER, parse_filter(mag_filter))

	return this
}

// RBOs ----------------------------------------------------------------------

let rbo = WebGLRenderbuffer.prototype

gl.rbo = function() {
	let rbo = this.createRenderbuffer()
	rbo.gl = this
	return rbo
}

rbo.bind = function() {
	let gl = this.gl
	gl.bindRenderbuffer(gl.RENDERBUFFER, this)
	return this
}

rbo.unbind = function() {
	let gl = this.gl
	gl.bindRenderbuffer(gl.RENDERBUFFER, null)
}

rbo.free = function() {
	this.gl.deleteRenderBuffer(this)
}

// NOTE: `n_samples` must be the same on _all_ RBOs attached to the same FBO.
// NOTE: can't blit a MSAA FBO onto a MSAA canvas (disable MSAA on the canvas!).
let rbo_set = function(rbo, gl, attach, gl_format, w, h, n_samples) {
	rbo.bind()
	if (n_samples != null) {
		n_samples = min(repl(n_samples, true, 4), gl.getParameter(gl.MAX_SAMPLES))
		gl.renderbufferStorageMultisample(gl.RENDERBUFFER, rbo.n_samples, gl_format, w, h)
	} else {
		n_samples = 1
		gl.renderbufferStorage(gl.RENDERBUFFER, gl_format, w, h)
	}
	rbo.w = w
	rbo.h = h
	rbo.n_samples = n_samples
	rbo.attach = attach
	return rbo
}

rbo.set_rgba = function(w, h, n_samples) {
	return rbo_set(this, this.gl, 'color', this.gl.RGBA8, w, h, n_samples)
}

rbo.set_depth = function(w, h, f32, n_samples) {
	let gl = this.gl
	let gl_format = f32 ? gl.DEPTH_COMPONENT32F : gl.DEPTH_COMPONENT24
	return rbo_set(this, gl, 'depth', gl_format, w, h, n_samples)
}

// FBOs ----------------------------------------------------------------------

let fbo = WebGLFramebuffer.prototype

gl.fbo = function() {
	let fbo = this.createFramebuffer()
	fbo.gl = this
	return fbo
}

let parse_attachment = function(gl, s, i) {
	if (s == 'color') return gl.COLOR_ATTACHMENT0 + i
	if (s == 'back') return gl.BACK
	if (s == 'none') return gl.NONE
	return assert(s, 'invalid attachment {0}', s)
}

gl.set_read_buffer = function(attachment, color_unit) {
	this.readBuffer(parse_attachment(this, attachment, color_unit))
}

gl.set_draw_buffers = function(attachments) {
	if (!isarray(attachments))
		attachments = [attachments || 'color']
	this.drawBuffers(attachments.map((s, i) => parse_attachment(this, s, i)))
}

fbo.bind = function(mode, attachments, color_unit) {
	let gl = this.gl
	assert(!gl.active_vao)
	assert(!gl.active_program)
	let gl_target
	if (mode == 'read') {
		if (this != gl.read_fbo) {
			gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this)
			gl.read_fbo = this
		}
		let att = parse_attachment(gl, attachments || 'color', color_unit || 0)
		if (this.read_attachment != att) {
			gl.readBuffer(att)
			this.read_attachment = att
		}
	} else if (!mode || mode == 'draw') {
		if (this != gl.draw_fbo) {
			gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this)
			gl.draw_fbo = this
		}
		gl.set_draw_buffers(attachments)
	} else
		assert(false)
	return this
}

gl.blit = function(
	src_fbo, read_attachment, color_unit,
	dst_fbo, draw_attachments,
	mask, filter,
	src_x0, src_y0, src_x1, src_y1,
	dst_x0, dst_y0, dst_x1, dst_y1
) {
	let gl = this

	assert(!gl.read_fbo)
	assert(!gl.draw_fbo)

	if (src_fbo) {
		src_fbo.bind('read', read_attachment, color_unit)
	} else {
		gl.set_read_buffer(read_attachment, color_unit)
	}

	if (dst_fbo) {
		dst_fbo.bind('draw', draw_attachments)
	} else {
		gl.set_draw_buffers(draw_attachments)
	}

	if (src_x0 == null) {
		src_x0 = 0
		src_y0 = 0
		src_x1 = src_fbo.w
		src_y1 = src_fbo.h
	} else {
		assert(src_x0 != null)
		assert(src_y0 != null)
		assert(src_x1 != null)
		assert(src_y1 != null)
	}

	if (dst_x0 == null) {
		dst_x0 = 0
		dst_y0 = 0
		dst_x1 = dst_fbo.w
		dst_y1 = dst_fbo.h
	} else {
		assert(dst_x0 != null)
		assert(dst_y0 != null)
		assert(dst_x1 != null)
		assert(dst_y1 != null)
	}

	mask = mask && (
			(mask.includes('color') && gl.COLOR_BUFFER_BIT || 0) ||
			(mask.includes('depth') && gl.DEPTH_BUFFER_BIT || 0) ||
			(mask.includes('stencil') && gl.STENCIL_BUFFER_BIT || 0)
		) || gl.COLOR_BUFFER_BIT

	filter = filter && (
			(filter.includes('nearest') && gl.NEAREST || 0) ||
			(filter.includes('linear') && gl.LINEAR || 0)
		) || gl.NEAREST

	gl.blitFramebuffer(
		src_x0, src_y0, src_x1, src_y1,
		dst_x0, dst_y0, dst_x1, dst_y1,
		mask, filter
	)

	if (src_fbo) src_fbo.unbind()
	if (dst_fbo) dst_fbo.unbind()
}

// NOTE: this is a total performance killer, use sparringly!
fbo.read_pixels = function(attachment, color_unit, buf, x, y, w, h) {
	let gl = this.gl
	let fbo = this
	assert(!gl.read_fbo)
	fbo.bind('read', attachment, color_unit)
	if (x == null) {
		x = 0
		y = 0
		w = fbo.w
		h = fbo.h
	} else {
		assert(x != null)
		assert(y != null)
		assert(w != null)
		assert(h != null)
	}
	let tex = assert(this.attachment(attachment, color_unit))
	if (tex.format == 'rgba') {
		if (!buf) {
			buf = new u8arr(w * h * 4)
		} else {
			check_arr_type(buf, u8arr)
		}
		gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
	} else if (tex.format == 'rgba16') {
		if (!buf) {
			buf = new u16arr(w * h * 4)
		} else {
			check_arr_type(buf, u16arr)
		}
		gl.readPixels(0, 0, w, h, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, buf)
	} else if (tex.format == 'u32') {
		if (!buf) {
			buf = new u32arr(w * h)
		} else {
			check_arr_type(buf, u32arr)
		}
		gl.readPixels(0, 0, w, h, gl.RED_INTEGER, gl.UNSIGNED_INT, buf)
	} else {
		assert(false, 'NYI: {0} texture', tex.format)
	}
	fbo.unbind()
	return buf
}

fbo.gl_target = function() {
	let gl = this.gl
	if (gl.read_fbo == this) return gl.READ_FRAMEBUFFER
	if (gl.draw_fbo == this) return gl.DRAW_FRAMEBUFFER
	assert(false, 'fbo not bound')
}

fbo.unbind = function() {
	let gl = this.gl
	assert(!gl.active_vao)
	assert(!gl.active_program)
	if (this == gl.read_fbo) {
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
		gl.read_fbo = null
	} else if (this == gl.draw_fbo) {
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
		gl.draw_fbo = null
	} else
		assert(false, 'not the bound fbo')
	return this
}

fbo.free = function() {
	this.gl.deleteFramebuffer(this)
}

fbo.attachment = function(target, color_unit) {
	return this.attachments && this.attachments[target + (color_unit || 0)]
}

let fbo_att = {
	color: gl.COLOR_ATTACHMENT0,
	depth: gl.DEPTH_ATTACHMENT,
	depth_stencil: gl.DEPTH_STENCIL_ATTACHMENT,
}
fbo.attach = function(tex_or_rbo, target, color_unit) {
	let gl = this.gl
	target = target || tex_or_rbo.attach
	color_unit = color_unit || 0
	let gl_attach = assert(fbo_att[target], 'invalid attachment target {0}', target) + color_unit
	if (tex_or_rbo instanceof WebGLRenderbuffer) {
		let rbo = tex_or_rbo
		rbo.bind()
		gl.framebufferRenderbuffer(this.gl_target(), gl_attach, gl.RENDERBUFFER, rbo)
		assert(this.n_samples == null || this.n_samples == rbo.n_samples,
			'different n_samples {0}, was {1}', rbo.n_samples, this.n_samples)
		this.n_samples = rbo.n_samples
	} else if (tex_or_rbo instanceof WebGLTexture) {
		let tex = tex_or_rbo
		gl.framebufferTexture2D(this.gl_target(), gl_attach, gl.TEXTURE_2D, tex, 0)
	} else
		assert(false, 'rbo or texture expected')

	attr(this, 'attachments')[target + color_unit] = tex_or_rbo

	return this
}

let _c = new f32arr(4)
let _u = new u32arr(4)
fbo.clear_color = function(color_unit, r, g, b, a) {
	let gl = this.gl
	assert(gl.draw_fbo == this, 'not the draw fbo')
	let tex = assert(this.attachment('color', color_unit))
	if (tex.format == 'rgba') {
		_c[0] = r
		_c[1] = g
		_c[2] = b
		_c[3] = or(a, 1)
		gl.clearBufferfv(gl.COLOR, color_unit, _c)
	} else if (tex.format == 'rgba16') {
		_u[0] = r
		_u[1] = g
		_u[2] = b
		_u[3] = or(a, 1)
		gl.clearBufferuiv(gl.COLOR, color_unit, _u)
	} else if (tex.format == 'u32') {
		_u[0] = r
		gl.clearBufferuiv(gl.COLOR, color_unit, _u)
	} else {
		assert(false, 'NYI: {0} texture', tex.format)
	}
}

fbo.clear_depth_stencil = function(depth, stencil) {
	let gl = this.gl
	assert(gl.draw_fbo == this, 'not the draw fbo')
	gl.clearBufferfi(gl.DEPTH_STENCIL, 0, or(depth, 1), or(stencil, 0))
}

}()) // module scope.
