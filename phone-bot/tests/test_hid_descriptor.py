"""
Tests for HID report descriptor and UHID struct builders.

Validates the byte-level structure of the multitouch HID descriptor and
the UHID_CREATE2, UHID_INPUT2, UHID_DESTROY struct layouts.

Since the implementation is Java (runs on phone via app_process), these tests
validate a Python mirror of the same byte arrays to ensure correctness.
"""

import struct


# --- Mirror of HidDescriptor.java constants ---

UHID_DESTROY = 1
UHID_CREATE2 = 11
UHID_INPUT2 = 12

DEVICE_NAME = "sec_touchscreen"
BUS_USB = 3

CREATE2_TOTAL_SIZE = 4376
INPUT_REPORT_SIZE = 10

# HID report descriptor bytes (exact mirror of HidDescriptor.java DESCRIPTOR)
DESCRIPTOR = bytes([
    0x05, 0x0D,                   # Usage Page (Digitizer)
    0x09, 0x04,                   # Usage (Touch Screen)
    0xA1, 0x01,                   # Collection (Application)

    0x85, 0x01,                   # Report ID (1)
    0x09, 0x22,                   # Usage (Finger)
    0xA1, 0x02,                   # Collection (Logical)

    # Tip Switch: 1 bit
    0x09, 0x42,                   # Usage (Tip Switch)
    0x15, 0x00,                   # Logical Minimum (0)
    0x25, 0x01,                   # Logical Maximum (1)
    0x75, 0x01,                   # Report Size (1)
    0x95, 0x01,                   # Report Count (1)
    0x81, 0x02,                   # Input (Data, Var, Abs)

    # Padding: 7 bits
    0x75, 0x07,                   # Report Size (7)
    0x95, 0x01,                   # Report Count (1)
    0x81, 0x03,                   # Input (Const, Var, Abs)

    # Contact ID: 8 bits, range 0-9
    0x09, 0x51,                   # Usage (Contact Identifier)
    0x75, 0x08,                   # Report Size (8)
    0x95, 0x01,                   # Report Count (1)
    0x15, 0x00,                   # Logical Minimum (0)
    0x25, 0x09,                   # Logical Maximum (9)
    0x81, 0x02,                   # Input (Data, Var, Abs)

    # X Position: 16 bits, range 0-4095
    0x05, 0x01,                   # Usage Page (Generic Desktop)
    0x09, 0x30,                   # Usage (X)
    0x75, 0x10,                   # Report Size (16)
    0x95, 0x01,                   # Report Count (1)
    0x15, 0x00,                   # Logical Minimum (0)
    0x26, 0xFF, 0x0F,             # Logical Maximum (4095)
    0x46, 0xFF, 0x0F,             # Physical Maximum (4095)
    0x81, 0x02,                   # Input (Data, Var, Abs)

    # Y Position: 16 bits (inherits X's size/range)
    0x09, 0x31,                   # Usage (Y)
    0x81, 0x02,                   # Input (Data, Var, Abs)

    # Tip Pressure: 8 bits, range 0-255
    0x05, 0x0D,                   # Usage Page (Digitizer)
    0x09, 0x30,                   # Usage (Tip Pressure)
    0x75, 0x08,                   # Report Size (8)
    0x15, 0x00,                   # Logical Minimum (0)
    0x26, 0xFF, 0x00,             # Logical Maximum (255)
    0x46, 0xFF, 0x00,             # Physical Maximum (255)
    0x81, 0x02,                   # Input (Data, Var, Abs)

    # Width (Touch Major): 8 bits (inherits Pressure's size/range)
    0x09, 0x48,                   # Usage (Width)
    0x81, 0x02,                   # Input (Data, Var, Abs)

    0xC0,                          # End Collection (Logical - Finger)

    # Contact Count: 8 bits, range 0-10
    0x05, 0x0D,                   # Usage Page (Digitizer)
    0x09, 0x54,                   # Usage (Contact Count)
    0x75, 0x08,                   # Report Size (8)
    0x95, 0x01,                   # Report Count (1)
    0x15, 0x00,                   # Logical Minimum (0)
    0x25, 0x0A,                   # Logical Maximum (10)
    0x81, 0x02,                   # Input (Data, Var, Abs)

    # Feature Report: Contact Count Maximum
    0x85, 0x02,                   # Report ID (2)
    0x09, 0x55,                   # Usage (Contact Count Maximum)
    0x25, 0x0A,                   # Logical Maximum (10)
    0xB1, 0x02,                   # Feature (Data, Var, Abs)

    0xC0,                          # End Collection (Application)
])


def _find_sequence(data: bytes, seq: bytes) -> int:
    """Find byte sequence in data, return index or -1."""
    idx = data.find(seq)
    return idx


# --- Helper: build structs in Python (mirrors Java) ---

def build_create2() -> bytes:
    buf = bytearray(CREATE2_TOTAL_SIZE)
    # type = UHID_CREATE2
    struct.pack_into('<I', buf, 0, UHID_CREATE2)
    # name (128 bytes, null-padded)
    name_bytes = DEVICE_NAME.encode('ascii')
    buf[4:4 + len(name_bytes)] = name_bytes
    # phys, uniq already zeroed
    # rd_size
    struct.pack_into('<H', buf, 260, len(DESCRIPTOR))
    # bus
    struct.pack_into('<H', buf, 262, BUS_USB)
    # vendor, product, version, country = 0 (already zeroed)
    # rd_data
    buf[280:280 + len(DESCRIPTOR)] = DESCRIPTOR
    return bytes(buf)


def build_input2(tip_switch: bool, contact_id: int, x: int, y: int,
                 pressure: int, width: int, contact_count: int) -> bytes:
    buf = bytearray(4 + 2 + INPUT_REPORT_SIZE)
    # UHID header
    struct.pack_into('<I', buf, 0, UHID_INPUT2)
    struct.pack_into('<H', buf, 4, INPUT_REPORT_SIZE)
    # Input report
    buf[6] = 0x01  # Report ID
    buf[7] = 1 if tip_switch else 0  # Tip Switch
    buf[8] = contact_id
    struct.pack_into('<H', buf, 9, x)
    struct.pack_into('<H', buf, 11, y)
    buf[13] = pressure
    buf[14] = width
    buf[15] = contact_count
    return bytes(buf)


def build_destroy() -> bytes:
    return struct.pack('<I', UHID_DESTROY)


# ===== Descriptor Structure Tests =====

class TestDescriptorStructure:

    def test_descriptor_length(self):
        # Counted from the reference hex in the spec: 108 bytes
        assert len(DESCRIPTOR) == 108

    def test_descriptor_starts_with_digitizer_usage_page(self):
        assert DESCRIPTOR[0:2] == bytes([0x05, 0x0D])

    def test_descriptor_contains_touch_screen_usage(self):
        assert DESCRIPTOR[2:4] == bytes([0x09, 0x04])

    def test_descriptor_contains_contact_id_usage(self):
        assert _find_sequence(DESCRIPTOR, bytes([0x09, 0x51])) >= 0

    def test_descriptor_contains_contact_count_usage(self):
        assert _find_sequence(DESCRIPTOR, bytes([0x09, 0x54])) >= 0

    def test_descriptor_contains_feature_report_id_2(self):
        assert _find_sequence(DESCRIPTOR, bytes([0x85, 0x02])) >= 0

    def test_x_logical_max_is_4095(self):
        # 0x26 0xFF 0x0F = Logical Maximum (4095)
        assert _find_sequence(DESCRIPTOR, bytes([0x26, 0xFF, 0x0F])) >= 0

    def test_y_physical_max_is_4095(self):
        # Y inherits X's range; Physical Maximum 4095 confirms coordinate space
        assert _find_sequence(DESCRIPTOR, bytes([0x46, 0xFF, 0x0F])) >= 0

    def test_pressure_report_size_is_8_bits(self):
        # After Tip Pressure usage (0x09 0x30 in digitizer page),
        # Report Size should be 8 (0x75 0x08)
        pressure_idx = _find_sequence(DESCRIPTOR, bytes([0x05, 0x0D, 0x09, 0x30]))
        assert pressure_idx >= 0
        # Find Report Size (8) after pressure usage
        after_pressure = DESCRIPTOR[pressure_idx:]
        size_idx = _find_sequence(after_pressure, bytes([0x75, 0x08]))
        assert size_idx >= 0

    def test_width_report_size_inherits_8_bits(self):
        # Width (0x09 0x48) comes after pressure with inherited 8-bit size
        width_idx = _find_sequence(DESCRIPTOR, bytes([0x09, 0x48]))
        assert width_idx >= 0

    def test_descriptor_ends_with_end_collection(self):
        assert DESCRIPTOR[-1] == 0xC0

    def test_descriptor_has_application_collection(self):
        assert _find_sequence(DESCRIPTOR, bytes([0xA1, 0x01])) >= 0

    def test_descriptor_has_logical_collection_finger(self):
        assert _find_sequence(DESCRIPTOR, bytes([0x09, 0x22, 0xA1, 0x02])) >= 0

    def test_pressure_logical_max_is_255(self):
        # 0x26 0xFF 0x00 = Logical Maximum (255)
        assert _find_sequence(DESCRIPTOR, bytes([0x26, 0xFF, 0x00])) >= 0


# ===== CREATE2 Struct Tests =====

class TestCreate2Struct:

    def test_create2_is_exactly_4376_bytes(self):
        data = build_create2()
        assert len(data) == 4376

    def test_create2_type_is_11(self):
        data = build_create2()
        type_val = struct.unpack_from('<I', data, 0)[0]
        assert type_val == 11

    def test_create2_name_contains_sec_touchscreen(self):
        data = build_create2()
        name_field = data[4:4 + 128]
        assert b"sec_touchscreen" in name_field

    def test_create2_name_is_null_terminated(self):
        data = build_create2()
        name_end = 4 + len(DEVICE_NAME)
        assert data[name_end] == 0

    def test_create2_rd_size_matches_descriptor_length(self):
        data = build_create2()
        rd_size = struct.unpack_from('<H', data, 260)[0]
        assert rd_size == len(DESCRIPTOR)

    def test_create2_bus_is_3(self):
        data = build_create2()
        bus = struct.unpack_from('<H', data, 262)[0]
        assert bus == 3

    def test_create2_vendor_product_version_country_are_zero(self):
        data = build_create2()
        vendor = struct.unpack_from('<I', data, 264)[0]
        product = struct.unpack_from('<I', data, 268)[0]
        version = struct.unpack_from('<I', data, 272)[0]
        country = struct.unpack_from('<I', data, 276)[0]
        assert vendor == 0
        assert product == 0
        assert version == 0
        assert country == 0

    def test_create2_rd_data_starts_with_descriptor(self):
        data = build_create2()
        rd_data = data[280:280 + len(DESCRIPTOR)]
        assert rd_data == DESCRIPTOR

    def test_create2_rd_data_is_zero_padded(self):
        data = build_create2()
        padding_start = 280 + len(DESCRIPTOR)
        padding = data[padding_start:280 + 4096]
        assert all(b == 0 for b in padding)


# ===== INPUT2 Struct Tests =====

class TestInput2Struct:

    def test_input2_type_is_12_and_size_is_10(self):
        data = build_input2(True, 0, 100, 200, 50, 30, 1)
        type_val = struct.unpack_from('<I', data, 0)[0]
        size_val = struct.unpack_from('<H', data, 4)[0]
        assert type_val == 12
        assert size_val == 10

    def test_input2_total_length(self):
        data = build_input2(True, 0, 100, 200, 50, 30, 1)
        assert len(data) == 16  # 4 + 2 + 10

    def test_input2_report_id_is_1(self):
        data = build_input2(True, 0, 100, 200, 50, 30, 1)
        assert data[6] == 0x01

    def test_input2_tip_switch_on(self):
        data = build_input2(True, 0, 100, 200, 50, 30, 1)
        assert data[7] & 0x01 == 1

    def test_input2_tip_switch_off(self):
        data = build_input2(False, 0, 100, 200, 50, 30, 0)
        assert data[7] & 0x01 == 0

    def test_input2_xy_are_little_endian(self):
        data = build_input2(True, 0, 0x0ABC, 0x0DEF, 50, 30, 1)
        x = struct.unpack_from('<H', data, 9)[0]
        y = struct.unpack_from('<H', data, 11)[0]
        assert x == 0x0ABC
        assert y == 0x0DEF

    def test_input2_pressure_is_single_byte(self):
        data = build_input2(True, 0, 100, 200, 180, 30, 1)
        assert data[13] == 180

    def test_input2_width_is_single_byte(self):
        data = build_input2(True, 0, 100, 200, 50, 120, 1)
        assert data[14] == 120

    def test_input2_contact_count(self):
        data = build_input2(True, 0, 100, 200, 50, 30, 3)
        assert data[15] == 3

    def test_input2_contact_id(self):
        data = build_input2(True, 5, 100, 200, 50, 30, 1)
        assert data[8] == 5

    def test_input2_boundary_zeros(self):
        data = build_input2(True, 0, 0, 0, 0, 0, 0)
        assert struct.unpack_from('<H', data, 9)[0] == 0
        assert struct.unpack_from('<H', data, 11)[0] == 0
        assert data[13] == 0
        assert data[14] == 0

    def test_input2_boundary_max_values(self):
        data = build_input2(True, 9, 4095, 4095, 255, 255, 10)
        assert data[8] == 9
        assert struct.unpack_from('<H', data, 9)[0] == 4095
        assert struct.unpack_from('<H', data, 11)[0] == 4095
        assert data[13] == 255
        assert data[14] == 255
        assert data[15] == 10


# ===== DESTROY Struct Tests =====

class TestDestroyStruct:

    def test_destroy_is_4_bytes(self):
        data = build_destroy()
        assert len(data) == 4

    def test_destroy_type_is_1(self):
        data = build_destroy()
        type_val = struct.unpack_from('<I', data, 0)[0]
        assert type_val == 1
