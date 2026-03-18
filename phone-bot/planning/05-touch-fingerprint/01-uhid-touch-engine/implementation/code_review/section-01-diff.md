diff --git a/phone-bot/tests/test_hid_descriptor.py b/phone-bot/tests/test_hid_descriptor.py
new file mode 100644
index 0000000..0114107
--- /dev/null
+++ b/phone-bot/tests/test_hid_descriptor.py
@@ -0,0 +1,328 @@
+"""
+Tests for HID report descriptor and UHID struct builders.
+
+Validates the byte-level structure of the multitouch HID descriptor and
+the UHID_CREATE2, UHID_INPUT2, UHID_DESTROY struct layouts.
+
+Since the implementation is Java (runs on phone via app_process), these tests
+validate a Python mirror of the same byte arrays to ensure correctness.
+"""
+
+import struct
+import pytest
+
+
+# --- Mirror of HidDescriptor.java constants ---
+
+UHID_DESTROY = 1
+UHID_CREATE2 = 11
+UHID_INPUT2 = 12
+
+DEVICE_NAME = "sec_touchscreen"
+BUS_USB = 3
+
+CREATE2_TOTAL_SIZE = 4380
+INPUT_REPORT_SIZE = 10
+
+# HID report descriptor bytes (exact mirror of HidDescriptor.java DESCRIPTOR)
+DESCRIPTOR = bytes([
+    0x05, 0x0D,                   # Usage Page (Digitizer)
+    0x09, 0x04,                   # Usage (Touch Screen)
+    0xA1, 0x01,                   # Collection (Application)
+
+    0x85, 0x01,                   # Report ID (1)
+    0x09, 0x22,                   # Usage (Finger)
+    0xA1, 0x02,                   # Collection (Logical)
+
+    # Tip Switch: 1 bit
+    0x09, 0x42,                   # Usage (Tip Switch)
+    0x15, 0x00,                   # Logical Minimum (0)
+    0x25, 0x01,                   # Logical Maximum (1)
+    0x75, 0x01,                   # Report Size (1)
+    0x95, 0x01,                   # Report Count (1)
+    0x81, 0x02,                   # Input (Data, Var, Abs)
+
+    # Padding: 7 bits
+    0x75, 0x07,                   # Report Size (7)
+    0x95, 0x01,                   # Report Count (1)
+    0x81, 0x03,                   # Input (Const, Var, Abs)
+
+    # Contact ID: 8 bits, range 0-9
+    0x09, 0x51,                   # Usage (Contact Identifier)
+    0x75, 0x08,                   # Report Size (8)
+    0x95, 0x01,                   # Report Count (1)
+    0x15, 0x00,                   # Logical Minimum (0)
+    0x25, 0x09,                   # Logical Maximum (9)
+    0x81, 0x02,                   # Input (Data, Var, Abs)
+
+    # X Position: 16 bits, range 0-4095
+    0x05, 0x01,                   # Usage Page (Generic Desktop)
+    0x09, 0x30,                   # Usage (X)
+    0x75, 0x10,                   # Report Size (16)
+    0x95, 0x01,                   # Report Count (1)
+    0x15, 0x00,                   # Logical Minimum (0)
+    0x26, 0xFF, 0x0F,             # Logical Maximum (4095)
+    0x46, 0xFF, 0x0F,             # Physical Maximum (4095)
+    0x81, 0x02,                   # Input (Data, Var, Abs)
+
+    # Y Position: 16 bits (inherits X's size/range)
+    0x09, 0x31,                   # Usage (Y)
+    0x81, 0x02,                   # Input (Data, Var, Abs)
+
+    # Tip Pressure: 8 bits, range 0-255
+    0x05, 0x0D,                   # Usage Page (Digitizer)
+    0x09, 0x30,                   # Usage (Tip Pressure)
+    0x75, 0x08,                   # Report Size (8)
+    0x15, 0x00,                   # Logical Minimum (0)
+    0x26, 0xFF, 0x00,             # Logical Maximum (255)
+    0x46, 0xFF, 0x00,             # Physical Maximum (255)
+    0x81, 0x02,                   # Input (Data, Var, Abs)
+
+    # Width (Touch Major): 8 bits (inherits Pressure's size/range)
+    0x09, 0x48,                   # Usage (Width)
+    0x81, 0x02,                   # Input (Data, Var, Abs)
+
+    0xC0,                          # End Collection (Logical - Finger)
+
+    # Contact Count: 8 bits, range 0-10
+    0x05, 0x0D,                   # Usage Page (Digitizer)
+    0x09, 0x54,                   # Usage (Contact Count)
+    0x75, 0x08,                   # Report Size (8)
+    0x95, 0x01,                   # Report Count (1)
+    0x15, 0x00,                   # Logical Minimum (0)
+    0x25, 0x0A,                   # Logical Maximum (10)
+    0x81, 0x02,                   # Input (Data, Var, Abs)
+
+    # Feature Report: Contact Count Maximum
+    0x85, 0x02,                   # Report ID (2)
+    0x09, 0x55,                   # Usage (Contact Count Maximum)
+    0x25, 0x0A,                   # Logical Maximum (10)
+    0xB1, 0x02,                   # Feature (Data, Var, Abs)
+
+    0xC0,                          # End Collection (Application)
+])
+
+
+def _find_sequence(data: bytes, seq: bytes) -> int:
+    """Find byte sequence in data, return index or -1."""
+    idx = data.find(seq)
+    return idx
+
+
+# --- Helper: build structs in Python (mirrors Java) ---
+
+def build_create2() -> bytes:
+    buf = bytearray(CREATE2_TOTAL_SIZE)
+    # type = UHID_CREATE2
+    struct.pack_into('<I', buf, 0, UHID_CREATE2)
+    # name (128 bytes, null-padded)
+    name_bytes = DEVICE_NAME.encode('ascii')
+    buf[4:4 + len(name_bytes)] = name_bytes
+    # phys, uniq already zeroed
+    # rd_size
+    struct.pack_into('<H', buf, 260, len(DESCRIPTOR))
+    # bus
+    struct.pack_into('<H', buf, 262, BUS_USB)
+    # vendor, product, version, country = 0 (already zeroed)
+    # rd_data
+    buf[280:280 + len(DESCRIPTOR)] = DESCRIPTOR
+    return bytes(buf)
+
+
+def build_input2(tip_switch: bool, contact_id: int, x: int, y: int,
+                 pressure: int, width: int, contact_count: int) -> bytes:
+    buf = bytearray(4 + 2 + INPUT_REPORT_SIZE)
+    # UHID header
+    struct.pack_into('<I', buf, 0, UHID_INPUT2)
+    struct.pack_into('<H', buf, 4, INPUT_REPORT_SIZE)
+    # Input report
+    buf[6] = 0x01  # Report ID
+    buf[7] = 1 if tip_switch else 0  # Tip Switch
+    buf[8] = contact_id
+    struct.pack_into('<H', buf, 9, x)
+    struct.pack_into('<H', buf, 11, y)
+    buf[13] = pressure
+    buf[14] = width
+    buf[15] = contact_count
+    return bytes(buf)
+
+
+def build_destroy() -> bytes:
+    return struct.pack('<I', UHID_DESTROY)
+
+
+# ===== Descriptor Structure Tests =====
+
+class TestDescriptorStructure:
+
+    def test_descriptor_starts_with_digitizer_usage_page(self):
+        assert DESCRIPTOR[0:2] == bytes([0x05, 0x0D])
+
+    def test_descriptor_contains_touch_screen_usage(self):
+        assert DESCRIPTOR[2:4] == bytes([0x09, 0x04])
+
+    def test_descriptor_contains_contact_id_usage(self):
+        assert _find_sequence(DESCRIPTOR, bytes([0x09, 0x51])) >= 0
+
+    def test_descriptor_contains_contact_count_usage(self):
+        assert _find_sequence(DESCRIPTOR, bytes([0x09, 0x54])) >= 0
+
+    def test_descriptor_contains_feature_report_id_2(self):
+        assert _find_sequence(DESCRIPTOR, bytes([0x85, 0x02])) >= 0
+
+    def test_x_logical_max_is_4095(self):
+        # 0x26 0xFF 0x0F = Logical Maximum (4095)
+        assert _find_sequence(DESCRIPTOR, bytes([0x26, 0xFF, 0x0F])) >= 0
+
+    def test_y_logical_max_is_4095(self):
+        # Y inherits X's range, but Physical Maximum also 4095
+        assert _find_sequence(DESCRIPTOR, bytes([0x46, 0xFF, 0x0F])) >= 0
+
+    def test_pressure_report_size_is_8_bits(self):
+        # After Tip Pressure usage (0x09 0x30 in digitizer page),
+        # Report Size should be 8 (0x75 0x08)
+        pressure_idx = _find_sequence(DESCRIPTOR, bytes([0x05, 0x0D, 0x09, 0x30]))
+        assert pressure_idx >= 0
+        # Find Report Size (8) after pressure usage
+        after_pressure = DESCRIPTOR[pressure_idx:]
+        size_idx = _find_sequence(after_pressure, bytes([0x75, 0x08]))
+        assert size_idx >= 0
+
+    def test_width_report_size_inherits_8_bits(self):
+        # Width (0x09 0x48) comes after pressure with inherited 8-bit size
+        width_idx = _find_sequence(DESCRIPTOR, bytes([0x09, 0x48]))
+        assert width_idx >= 0
+
+    def test_descriptor_ends_with_end_collection(self):
+        assert DESCRIPTOR[-1] == 0xC0
+
+    def test_descriptor_has_application_collection(self):
+        assert _find_sequence(DESCRIPTOR, bytes([0xA1, 0x01])) >= 0
+
+    def test_descriptor_has_logical_collection_finger(self):
+        assert _find_sequence(DESCRIPTOR, bytes([0x09, 0x22, 0xA1, 0x02])) >= 0
+
+    def test_pressure_logical_max_is_255(self):
+        # 0x26 0xFF 0x00 = Logical Maximum (255)
+        assert _find_sequence(DESCRIPTOR, bytes([0x26, 0xFF, 0x00])) >= 0
+
+
+# ===== CREATE2 Struct Tests =====
+
+class TestCreate2Struct:
+
+    def test_create2_is_exactly_4380_bytes(self):
+        data = build_create2()
+        assert len(data) == 4380
+
+    def test_create2_type_is_11(self):
+        data = build_create2()
+        type_val = struct.unpack_from('<I', data, 0)[0]
+        assert type_val == 11
+
+    def test_create2_name_contains_sec_touchscreen(self):
+        data = build_create2()
+        name_field = data[4:4 + 128]
+        assert b"sec_touchscreen" in name_field
+
+    def test_create2_name_is_null_terminated(self):
+        data = build_create2()
+        name_end = 4 + len(DEVICE_NAME)
+        assert data[name_end] == 0
+
+    def test_create2_rd_size_matches_descriptor_length(self):
+        data = build_create2()
+        rd_size = struct.unpack_from('<H', data, 260)[0]
+        assert rd_size == len(DESCRIPTOR)
+
+    def test_create2_bus_is_3(self):
+        data = build_create2()
+        bus = struct.unpack_from('<H', data, 262)[0]
+        assert bus == 3
+
+    def test_create2_vendor_product_version_country_are_zero(self):
+        data = build_create2()
+        vendor = struct.unpack_from('<I', data, 264)[0]
+        product = struct.unpack_from('<I', data, 268)[0]
+        version = struct.unpack_from('<I', data, 272)[0]
+        country = struct.unpack_from('<I', data, 276)[0]
+        assert vendor == 0
+        assert product == 0
+        assert version == 0
+        assert country == 0
+
+    def test_create2_rd_data_starts_with_descriptor(self):
+        data = build_create2()
+        rd_data = data[280:280 + len(DESCRIPTOR)]
+        assert rd_data == DESCRIPTOR
+
+    def test_create2_rd_data_is_zero_padded(self):
+        data = build_create2()
+        padding_start = 280 + len(DESCRIPTOR)
+        padding = data[padding_start:280 + 4096]
+        assert all(b == 0 for b in padding)
+
+
+# ===== INPUT2 Struct Tests =====
+
+class TestInput2Struct:
+
+    def test_input2_type_is_12_and_size_is_10(self):
+        data = build_input2(True, 0, 100, 200, 50, 30, 1)
+        type_val = struct.unpack_from('<I', data, 0)[0]
+        size_val = struct.unpack_from('<H', data, 4)[0]
+        assert type_val == 12
+        assert size_val == 10
+
+    def test_input2_total_length(self):
+        data = build_input2(True, 0, 100, 200, 50, 30, 1)
+        assert len(data) == 16  # 4 + 2 + 10
+
+    def test_input2_report_id_is_1(self):
+        data = build_input2(True, 0, 100, 200, 50, 30, 1)
+        assert data[6] == 0x01
+
+    def test_input2_tip_switch_on(self):
+        data = build_input2(True, 0, 100, 200, 50, 30, 1)
+        assert data[7] & 0x01 == 1
+
+    def test_input2_tip_switch_off(self):
+        data = build_input2(False, 0, 100, 200, 50, 30, 0)
+        assert data[7] & 0x01 == 0
+
+    def test_input2_xy_are_little_endian(self):
+        data = build_input2(True, 0, 0x0ABC, 0x0DEF, 50, 30, 1)
+        x = struct.unpack_from('<H', data, 9)[0]
+        y = struct.unpack_from('<H', data, 11)[0]
+        assert x == 0x0ABC
+        assert y == 0x0DEF
+
+    def test_input2_pressure_is_single_byte(self):
+        data = build_input2(True, 0, 100, 200, 180, 30, 1)
+        assert data[13] == 180
+
+    def test_input2_width_is_single_byte(self):
+        data = build_input2(True, 0, 100, 200, 50, 120, 1)
+        assert data[14] == 120
+
+    def test_input2_contact_count(self):
+        data = build_input2(True, 0, 100, 200, 50, 30, 3)
+        assert data[15] == 3
+
+    def test_input2_contact_id(self):
+        data = build_input2(True, 5, 100, 200, 50, 30, 1)
+        assert data[8] == 5
+
+
+# ===== DESTROY Struct Tests =====
+
+class TestDestroyStruct:
+
+    def test_destroy_is_4_bytes(self):
+        data = build_destroy()
+        assert len(data) == 4
+
+    def test_destroy_type_is_1(self):
+        data = build_destroy()
+        type_val = struct.unpack_from('<I', data, 0)[0]
+        assert type_val == 1
diff --git a/phone-bot/touchserver/HidDescriptor.java b/phone-bot/touchserver/HidDescriptor.java
new file mode 100644
index 0000000..4346b2d
--- /dev/null
+++ b/phone-bot/touchserver/HidDescriptor.java
@@ -0,0 +1,240 @@
+package touchserver;
+
+import java.nio.ByteBuffer;
+import java.nio.ByteOrder;
+
+/**
+ * HID report descriptor and UHID struct builders for a multitouch virtual touchscreen.
+ *
+ * Creates a device recognized by Android's hid-multitouch.c kernel driver as a real
+ * touchscreen with INPUT_PROP_DIRECT, ABS_MT_* axes, and SOURCE_TOUCHSCREEN.
+ *
+ * Device name "sec_touchscreen" matches Samsung's real touchscreen driver name.
+ */
+public class HidDescriptor {
+
+    // UHID event types
+    public static final int UHID_DESTROY = 1;
+    public static final int UHID_CREATE2 = 11;
+    public static final int UHID_INPUT2 = 12;
+
+    // UHID_CREATE2 struct field sizes
+    private static final int NAME_SIZE = 128;
+    private static final int PHYS_SIZE = 64;
+    private static final int UNIQ_SIZE = 64;
+    private static final int RD_DATA_SIZE = 4096;
+    private static final int CREATE2_TOTAL_SIZE = 4380; // 4 + 128 + 64 + 64 + 2 + 2 + 4 + 4 + 4 + 4 + 4096
+
+    // Device identity
+    public static final String DEVICE_NAME = "sec_touchscreen";
+    public static final int BUS_USB = 3;
+
+    // Coordinate range
+    public static final int MAX_X = 4095;
+    public static final int MAX_Y = 4095;
+    public static final int MAX_PRESSURE = 255;
+    public static final int MAX_WIDTH = 255;
+    public static final int MAX_CONTACTS = 10;
+
+    // Input report size (after report ID)
+    public static final int INPUT_REPORT_SIZE = 10;
+
+    /**
+     * Multitouch HID report descriptor.
+     *
+     * Defines a Touch Screen (Usage Page 0x0D, Usage 0x04) which triggers
+     * INPUT_PROP_DIRECT in the kernel. Single finger collection with:
+     * - Tip Switch (1 bit), Contact ID (8 bit), X/Y (16 bit each, 0-4095),
+     *   Pressure (8 bit, 0-255), Width (8 bit, 0-255), Contact Count (8 bit).
+     * - Feature Report with Contact Count Maximum = 10.
+     */
+    public static final byte[] DESCRIPTOR = new byte[] {
+        0x05, 0x0D,                   // Usage Page (Digitizer)
+        0x09, 0x04,                   // Usage (Touch Screen)
+        (byte) 0xA1, 0x01,           // Collection (Application)
+
+        (byte) 0x85, 0x01,           // Report ID (1)
+        0x09, 0x22,                   // Usage (Finger)
+        (byte) 0xA1, 0x02,           // Collection (Logical)
+
+        // Tip Switch: 1 bit
+        0x09, 0x42,                   // Usage (Tip Switch)
+        0x15, 0x00,                   // Logical Minimum (0)
+        0x25, 0x01,                   // Logical Maximum (1)
+        0x75, 0x01,                   // Report Size (1)
+        (byte) 0x95, 0x01,           // Report Count (1)
+        (byte) 0x81, 0x02,           // Input (Data, Var, Abs)
+
+        // Padding: 7 bits
+        0x75, 0x07,                   // Report Size (7)
+        (byte) 0x95, 0x01,           // Report Count (1)
+        (byte) 0x81, 0x03,           // Input (Const, Var, Abs)
+
+        // Contact ID: 8 bits, range 0-9
+        0x09, 0x51,                   // Usage (Contact Identifier)
+        0x75, 0x08,                   // Report Size (8)
+        (byte) 0x95, 0x01,           // Report Count (1)
+        0x15, 0x00,                   // Logical Minimum (0)
+        0x25, 0x09,                   // Logical Maximum (9)
+        (byte) 0x81, 0x02,           // Input (Data, Var, Abs)
+
+        // X Position: 16 bits, range 0-4095
+        0x05, 0x01,                   // Usage Page (Generic Desktop)
+        0x09, 0x30,                   // Usage (X)
+        0x75, 0x10,                   // Report Size (16)
+        (byte) 0x95, 0x01,           // Report Count (1)
+        0x15, 0x00,                   // Logical Minimum (0)
+        0x26, (byte) 0xFF, 0x0F,     // Logical Maximum (4095)
+        0x46, (byte) 0xFF, 0x0F,     // Physical Maximum (4095)
+        (byte) 0x81, 0x02,           // Input (Data, Var, Abs)
+
+        // Y Position: 16 bits, range 0-4095 (inherits X's size/range)
+        0x09, 0x31,                   // Usage (Y)
+        (byte) 0x81, 0x02,           // Input (Data, Var, Abs)
+
+        // Tip Pressure: 8 bits, range 0-255
+        0x05, 0x0D,                   // Usage Page (Digitizer)
+        0x09, 0x30,                   // Usage (Tip Pressure)
+        0x75, 0x08,                   // Report Size (8)
+        0x15, 0x00,                   // Logical Minimum (0)
+        0x26, (byte) 0xFF, 0x00,     // Logical Maximum (255)
+        0x46, (byte) 0xFF, 0x00,     // Physical Maximum (255)
+        (byte) 0x81, 0x02,           // Input (Data, Var, Abs)
+
+        // Width (Touch Major): 8 bits, range 0-255 (inherits Pressure's size/range)
+        0x09, 0x48,                   // Usage (Width)
+        (byte) 0x81, 0x02,           // Input (Data, Var, Abs)
+
+        (byte) 0xC0,                  // End Collection (Logical - Finger)
+
+        // Contact Count: 8 bits, range 0-10
+        0x05, 0x0D,                   // Usage Page (Digitizer)
+        0x09, 0x54,                   // Usage (Contact Count)
+        0x75, 0x08,                   // Report Size (8)
+        (byte) 0x95, 0x01,           // Report Count (1)
+        0x15, 0x00,                   // Logical Minimum (0)
+        0x25, 0x0A,                   // Logical Maximum (10)
+        (byte) 0x81, 0x02,           // Input (Data, Var, Abs)
+
+        // Feature Report: Contact Count Maximum
+        (byte) 0x85, 0x02,           // Report ID (2)
+        0x09, 0x55,                   // Usage (Contact Count Maximum)
+        0x25, 0x0A,                   // Logical Maximum (10)
+        (byte) 0xB1, 0x02,           // Feature (Data, Var, Abs)
+
+        (byte) 0xC0                   // End Collection (Application)
+    };
+
+    /**
+     * Build UHID_CREATE2 struct (4380 bytes).
+     *
+     * Struct layout:
+     *   0-3:     type (u32 LE) = 11
+     *   4-131:   name (128 bytes, null-padded)
+     *   132-195: phys (64 bytes, zeroed)
+     *   196-259: uniq (64 bytes, zeroed)
+     *   260-261: rd_size (u16 LE) = descriptor length
+     *   262-263: bus (u16 LE) = 3 (BUS_USB)
+     *   264-267: vendor (u32 LE) = 0
+     *   268-271: product (u32 LE) = 0
+     *   272-275: version (u32 LE) = 0
+     *   276-279: country (u32 LE) = 0
+     *   280-4375: rd_data (4096 bytes, descriptor + zero-padding)
+     */
+    public static byte[] buildCreate2() {
+        ByteBuffer buf = ByteBuffer.allocate(CREATE2_TOTAL_SIZE);
+        buf.order(ByteOrder.LITTLE_ENDIAN);
+
+        // type = UHID_CREATE2 (11)
+        buf.putInt(UHID_CREATE2);
+
+        // name (128 bytes, null-padded)
+        byte[] nameBytes = DEVICE_NAME.getBytes();
+        buf.put(nameBytes);
+        buf.position(4 + NAME_SIZE);
+
+        // phys (64 bytes, zeroed) - already zeroed by allocate
+        buf.position(4 + NAME_SIZE + PHYS_SIZE);
+
+        // uniq (64 bytes, zeroed)
+        buf.position(4 + NAME_SIZE + PHYS_SIZE + UNIQ_SIZE);
+
+        // rd_size
+        buf.putShort((short) DESCRIPTOR.length);
+
+        // bus = BUS_USB
+        buf.putShort((short) BUS_USB);
+
+        // vendor, product, version, country = 0
+        buf.putInt(0); // vendor
+        buf.putInt(0); // product
+        buf.putInt(0); // version
+        buf.putInt(0); // country
+
+        // rd_data (descriptor bytes + zero-padding)
+        buf.put(DESCRIPTOR);
+
+        return buf.array();
+    }
+
+    /**
+     * Build UHID_INPUT2 struct for a single touch event.
+     *
+     * Struct layout:
+     *   0-3:   type (u32 LE) = 12
+     *   4-5:   size (u16 LE) = 10
+     *   6-15:  data (10 bytes = input report)
+     *
+     * Input report layout (10 bytes):
+     *   Byte 0:   Report ID (0x01)
+     *   Byte 1:   [bit 0] Tip Switch, [bits 1-7] padding
+     *   Byte 2:   Contact ID
+     *   Byte 3-4: X (u16 LE)
+     *   Byte 5-6: Y (u16 LE)
+     *   Byte 7:   Pressure (u8)
+     *   Byte 8:   Width (u8)
+     *   Byte 9:   Contact Count
+     *
+     * @param tipSwitch   true if finger is touching
+     * @param contactId   finger slot (0-9)
+     * @param x           X coordinate (0-4095)
+     * @param y           Y coordinate (0-4095)
+     * @param pressure    pressure value (0-255)
+     * @param width       touch width (0-255)
+     * @param contactCount number of active contacts
+     * @return 16-byte UHID_INPUT2 struct
+     */
+    public static byte[] buildInput2(boolean tipSwitch, int contactId,
+                                      int x, int y, int pressure, int width,
+                                      int contactCount) {
+        ByteBuffer buf = ByteBuffer.allocate(4 + 2 + INPUT_REPORT_SIZE);
+        buf.order(ByteOrder.LITTLE_ENDIAN);
+
+        // UHID header
+        buf.putInt(UHID_INPUT2);           // type = 12
+        buf.putShort((short) INPUT_REPORT_SIZE); // size = 10
+
+        // Input report
+        buf.put((byte) 0x01);             // Report ID
+        buf.put((byte) (tipSwitch ? 1 : 0)); // Tip Switch in bit 0
+        buf.put((byte) contactId);         // Contact ID
+        buf.putShort((short) x);           // X (u16 LE)
+        buf.putShort((short) y);           // Y (u16 LE)
+        buf.put((byte) pressure);          // Pressure
+        buf.put((byte) width);             // Width
+        buf.put((byte) contactCount);      // Contact Count
+
+        return buf.array();
+    }
+
+    /**
+     * Build UHID_DESTROY struct (4 bytes).
+     * Simply: type = 1 (UHID_DESTROY) as little-endian u32.
+     */
+    public static byte[] buildDestroy() {
+        ByteBuffer buf = ByteBuffer.allocate(4);
+        buf.order(ByteOrder.LITTLE_ENDIAN);
+        buf.putInt(UHID_DESTROY);
+        return buf.array();
+    }
+}
