// utils/certificationFormatter.js

/**
 * Formats certifications from form data (arrays) to array of objects
 * @param {Object} body - Request body containing certification data
 * @returns {Array} - Array of certification objects
 */
export const formatCertifications = (body) => {
    if (!body.certifications) return [];

    const certs = [];
    const certData = body.certifications;

    // Determine the length (use name array length as reference)
    const length = certData.name?.length || 0;

    for (let i = 0; i < length; i++) {
        // Skip if no name provided
        if (!certData.name[i] || certData.name[i].trim() === "") continue;
        
        certs.push({
            name: certData.name[i],
            issuedBy: certData.issuedBy?.[i] || "",
            issueDate: certData.issueDate?.[i] ? new Date(certData.issueDate[i]) : null,
            expiryDate: certData.expiryDate?.[i] ? new Date(certData.expiryDate[i]) : null,
            documentName: certData.documentName?.[i] || "",
            documentUrl: certData.documentUrl?.[i] || null,
            _id: certData._id?.[i] || undefined // Keep existing _id if updating
        });
    }

    return certs;
};

/**
 * Formats certifications from object to form data format
 * @param {Array} certifications - Array of certification objects
 * @returns {Object} - Formatted object with arrays for form fields
 */
export const formatCertificationsForForm = (certifications) => {
    if (!certifications || !Array.isArray(certifications)) {
        return {
            name: [],
            issuedBy: [],
            issueDate: [],
            expiryDate: [],
            documentName: [],
            documentUrl: [],
            _id: []
        };
    }

    return {
        name: certifications.map(cert => cert.name || ""),
        issuedBy: certifications.map(cert => cert.issuedBy || ""),
        issueDate: certifications.map(cert => cert.issueDate ? new Date(cert.issueDate).toISOString().split('T')[0] : ""),
        expiryDate: certifications.map(cert => cert.expiryDate ? new Date(cert.expiryDate).toISOString().split('T')[0] : ""),
        documentName: certifications.map(cert => cert.documentName || ""),
        documentUrl: certifications.map(cert => cert.documentUrl || null),
        _id: certifications.map(cert => cert._id || undefined)
    };
};